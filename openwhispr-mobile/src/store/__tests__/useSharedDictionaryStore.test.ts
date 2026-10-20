const mockSyncState = new Map<string, string>();
jest.mock('@/data', () => ({
  notesRepository: {
    getSyncState: (key: string): string | null => mockSyncState.get(key) ?? null,
    setSyncState: (key: string, value: string): void => {
      mockSyncState.set(key, value);
    },
    clearSyncState: (key: string): void => {
      mockSyncState.delete(key);
    },
  },
}));

import { useSharedDictionaryStore } from '../useSharedDictionaryStore';
import {
  saveSharedDictionaryState,
  SHARED_DICTIONARY_STATE_KEY,
  type SharedDictionaryState,
} from '@/sync/sharedDictionaryState';

const scope = (spaceId: string | null): SharedDictionaryState['scopes'][number] => ({
  space_id: spaceId,
  name: spaceId ?? 'Workspace',
  member_count: 2,
  word_count: 1,
});

const STATE: SharedDictionaryState = {
  workspaceId: 'ws-1',
  workspaceName: 'Acme',
  entries: {
    e1: { spaceId: null, word: 'Acme' },
    e2: { spaceId: 'space-1', word: 'Gizmo' },
    e3: { spaceId: 'space-1', word: 'Hidden' },
    e4: { spaceId: null, word: 'line\nbreak' },
  },
  hiddenIds: ['e3'],
  scopes: [scope(null), scope('space-1')],
  paused: false,
};

beforeEach(() => {
  mockSyncState.clear();
  useSharedDictionaryStore.getState().reset();
});

describe('useSharedDictionaryStore', () => {
  it('starts empty', () => {
    const { hints, sharedWordsLower, summary } = useSharedDictionaryStore.getState();
    expect(hints).toEqual({ space: [], workspace: [] });
    expect(sharedWordsLower.size).toBe(0);
    expect(summary).toBeNull();
  });

  it('loads the applying words and a summary from the stored state', async () => {
    await saveSharedDictionaryState(STATE);
    await useSharedDictionaryStore.getState().load();

    const { hints, sharedWordsLower, summary } = useSharedDictionaryStore.getState();
    expect(hints).toEqual({ space: ['Gizmo'], workspace: ['Acme'] });
    expect(summary).toEqual({ count: 2, workspaceName: 'Acme' });
    // Hidden words still count: a hidden shared copy keeps a moved personal
    // word out of the personal list.
    expect([...sharedWordsLower].sort()).toEqual(['acme', 'gizmo', 'hidden', 'line\nbreak']);
  });

  it('applies nothing while paused, but still knows the shared words', async () => {
    await saveSharedDictionaryState({ ...STATE, paused: true });
    await useSharedDictionaryStore.getState().load();

    const { hints, sharedWordsLower, summary } = useSharedDictionaryStore.getState();
    expect(hints).toEqual({ space: [], workspace: [] });
    expect(summary).toBeNull();
    expect(sharedWordsLower.has('acme')).toBe(true);
  });

  it('empties when the stored state is gone', async () => {
    await saveSharedDictionaryState(STATE);
    await useSharedDictionaryStore.getState().load();
    await saveSharedDictionaryState(null);
    await useSharedDictionaryStore.getState().load();

    const { hints, sharedWordsLower, summary } = useSharedDictionaryStore.getState();
    expect(hints).toEqual({ space: [], workspace: [] });
    expect(sharedWordsLower.size).toBe(0);
    expect(summary).toBeNull();
  });

  it('treats an unreadable stored state as none', async () => {
    mockSyncState.set(SHARED_DICTIONARY_STATE_KEY, '{not json');
    await useSharedDictionaryStore.getState().load();
    expect(useSharedDictionaryStore.getState().hints).toEqual({ space: [], workspace: [] });
  });

  it('reset clears the words at once', async () => {
    await saveSharedDictionaryState(STATE);
    await useSharedDictionaryStore.getState().load();
    useSharedDictionaryStore.getState().reset();

    const { hints, sharedWordsLower, summary } = useSharedDictionaryStore.getState();
    expect(hints).toEqual({ space: [], workspace: [] });
    expect(sharedWordsLower.size).toBe(0);
    expect(summary).toBeNull();
  });

  it('a load that began before a reset does not bring the words back', async () => {
    await saveSharedDictionaryState(STATE);
    const loading = useSharedDictionaryStore.getState().load();
    useSharedDictionaryStore.getState().reset();
    await loading;

    expect(useSharedDictionaryStore.getState().hints).toEqual({ space: [], workspace: [] });
  });
});
