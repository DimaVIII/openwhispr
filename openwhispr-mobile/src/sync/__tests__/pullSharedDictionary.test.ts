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

// apiClient pulls in expo/fetch, which jest-expo cannot instantiate.
jest.mock('@/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

const mockFetchSharedDictionary = jest.fn();
const mockFetchSharedDictionaryHides = jest.fn();
jest.mock('@/data/remote/sharedDictionaryApi', () => ({
  fetchSharedDictionary: (...args: unknown[]) => mockFetchSharedDictionary(...args),
  fetchSharedDictionaryHides: (...args: unknown[]) => mockFetchSharedDictionaryHides(...args),
}));

const mockFetchMyWorkspaces = jest.fn();
jest.mock('@/data/remote/workspacesApi', () => ({
  fetchMyWorkspaces: (...args: unknown[]) => mockFetchMyWorkspaces(...args),
}));

const mockUsageState: {
  usage: { entitlementSources?: { workspaceIds: string[] } } | null;
  load: jest.Mock;
} = { usage: null, load: jest.fn() };
jest.mock('@/store/useUsageStore', () => ({
  useUsageStore: { getState: () => mockUsageState },
}));

import { pullSharedDictionary } from '../pullSharedDictionary';
import {
  SHARED_DICTIONARY_CURSOR_ID_KEY,
  SHARED_DICTIONARY_CURSOR_KEY,
  SHARED_DICTIONARY_HIDES_CURSOR_ID_KEY,
  SHARED_DICTIONARY_HIDES_CURSOR_KEY,
  resetAllPullCursors,
} from '../pullCursors';
import {
  loadSharedDictionaryState,
  saveSharedDictionaryState,
  SHARED_DICTIONARY_STATE_KEY,
  type SharedDictionaryState,
} from '../sharedDictionaryState';
import { ApiError } from '@/lib/apiClient';
import type {
  RemoteSharedEntry,
  RemoteSharedHide,
  RemoteSharedScope,
} from '@/data/remote/sharedDictionaryApi';

const T0 = '2026-10-20T10:00:00.000Z';
const T0_MINUS_10S = '2026-10-20T09:59:50.000Z';
const T1 = '2026-10-20T11:00:00.000Z';
const T2 = '2026-10-20T11:00:05.000Z';
const H1 = '2026-10-20T11:00:01.000Z';

const scope = (spaceId: string | null): RemoteSharedScope => ({
  space_id: spaceId,
  name: spaceId ?? 'Workspace',
  member_count: 2,
  word_count: 1,
});

const entry = (
  id: string,
  word: string,
  overrides: Partial<RemoteSharedEntry> = {},
): RemoteSharedEntry => ({
  id,
  workspace_id: 'ws-1',
  space_id: null,
  word,
  created_at: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
  updated_at: `2026-10-1${id.slice(-1)}T00:00:00.000Z`,
  deleted_at: null,
  ...overrides,
});

const hide = (entryId: string, overrides: Partial<RemoteSharedHide> = {}): RemoteSharedHide => ({
  entry_id: entryId,
  workspace_id: 'ws-1',
  updated_at: `2026-10-1${entryId.slice(-1)}T01:00:00.000Z`,
  deleted_at: null,
  ...overrides,
});

const listPage = (
  entries: RemoteSharedEntry[],
  overrides: Partial<{
    hasMore: boolean;
    scopes: RemoteSharedScope[];
    paused: boolean;
    server_time: string;
  }> = {},
): object => ({
  entries,
  hasMore: false,
  scopes: [scope(null), scope('space-1')],
  paused: false,
  server_time: T1,
  ...overrides,
});

const hidesPage = (
  hides: RemoteSharedHide[],
  overrides: Partial<{ hasMore: boolean; server_time: string }> = {},
): object => ({ hides, hasMore: false, server_time: H1, ...overrides });

const STORED: SharedDictionaryState = {
  workspaceId: 'ws-1',
  workspaceName: 'Acme',
  entries: {
    e1: { spaceId: null, word: 'Acme' },
    e2: { spaceId: 'space-1', word: 'Gizmo' },
  },
  hiddenIds: [],
  scopes: [scope(null), scope('space-1')],
  paused: false,
};

async function seedStored(state: SharedDictionaryState = STORED): Promise<void> {
  await saveSharedDictionaryState(state);
  mockSyncState.set(SHARED_DICTIONARY_CURSOR_KEY, T0);
  mockSyncState.set(SHARED_DICTIONARY_HIDES_CURSOR_KEY, T0);
}

type ApiErrorClass = new (message: string, status: number, code?: string) => Error;

// An isolated module registry has its own ApiError class (loadIsolatedPull),
// which its tests pass in for instanceof to hold.
function apiError(status: number, code?: string, ErrorClass: unknown = ApiError): Error {
  return new (ErrorClass as ApiErrorClass)('failed', status, code);
}

// A fresh copy of the module, so the session flag a test sets stays out of the
// others. It comes with its own ApiError class.
function loadIsolatedPull(): { pull: typeof pullSharedDictionary; ApiError: unknown } {
  let isolated!: { pull: typeof pullSharedDictionary; ApiError: unknown };
  jest.isolateModules(() => {
    isolated = {
      pull: require('../pullSharedDictionary').pullSharedDictionary,
      ApiError: require('@/lib/apiClient').ApiError,
    };
  });
  return isolated;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncState.clear();
  mockUsageState.usage = null;
  mockUsageState.load.mockImplementation(async () => ({ usage: mockUsageState.usage }));
  mockFetchMyWorkspaces.mockResolvedValue({ data: [{ id: 'ws-1', name: 'Acme' }] });
  mockFetchSharedDictionary.mockResolvedValue(listPage([]));
  mockFetchSharedDictionaryHides.mockResolvedValue(hidesPage([]));
});

describe('pullSharedDictionary', () => {
  it('first pull pages the snapshot then stores delta cursors', async () => {
    mockFetchSharedDictionary
      .mockResolvedValueOnce(listPage([entry('e1', 'Acme')], { hasMore: true, server_time: T1 }))
      .mockResolvedValueOnce(
        listPage([entry('e2', 'Gizmo', { space_id: 'space-1' })], { server_time: T2 }),
      );
    mockFetchSharedDictionaryHides.mockResolvedValueOnce(hidesPage([hide('e2')]));

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect(mockFetchSharedDictionary).toHaveBeenNthCalledWith(1, 'ws-1', { limit: 200 });
    expect(mockFetchSharedDictionary).toHaveBeenNthCalledWith(2, 'ws-1', {
      cursor: '2026-10-01T00:00:00.000Z',
      cursorId: 'e1',
      limit: 200,
    });
    expect(mockFetchSharedDictionaryHides).toHaveBeenCalledWith('ws-1', { limit: 200 });
    expect(await loadSharedDictionaryState()).toEqual({
      workspaceId: 'ws-1',
      workspaceName: 'Acme',
      entries: {
        e1: { spaceId: null, word: 'Acme' },
        e2: { spaceId: 'space-1', word: 'Gizmo' },
      },
      hiddenIds: ['e2'],
      scopes: [scope(null), scope('space-1')],
      paused: false,
    });
    // The FIRST page's server_time, so a row deleted behind page 2 is re-read.
    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_KEY)).toBe(T1);
    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_ID_KEY)).toBe('e2');
    expect(mockSyncState.get(SHARED_DICTIONARY_HIDES_CURSOR_KEY)).toBe(H1);
    expect(mockSyncState.get(SHARED_DICTIONARY_HIDES_CURSOR_ID_KEY)).toBe('e2');
  });

  it('pages the hides snapshot on the last hide', async () => {
    mockFetchSharedDictionary.mockResolvedValueOnce(listPage([entry('e1', 'Acme')]));
    mockFetchSharedDictionaryHides
      .mockResolvedValueOnce(hidesPage([hide('e1')], { hasMore: true }))
      .mockResolvedValueOnce(hidesPage([]));

    await pullSharedDictionary();

    expect(mockFetchSharedDictionaryHides).toHaveBeenNthCalledWith(2, 'ws-1', {
      cursor: '2026-10-11T01:00:00.000Z',
      cursorId: 'e1',
      limit: 200,
    });
    expect((await loadSharedDictionaryState())?.hiddenIds).toEqual(['e1']);
  });

  it('delta passes overlap the stored cursor by 10 seconds', async () => {
    await seedStored();
    mockFetchSharedDictionary.mockResolvedValueOnce(
      listPage([entry('e1', 'Acme')], { server_time: T1 }),
    );

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: false });

    expect(mockFetchSharedDictionary).toHaveBeenCalledTimes(1);
    expect(mockFetchSharedDictionary).toHaveBeenCalledWith('ws-1', {
      since: T0_MINUS_10S,
      limit: 200,
    });
    expect(mockFetchSharedDictionaryHides).toHaveBeenCalledWith('ws-1', {
      since: T0_MINUS_10S,
      limit: 200,
    });
    expect(await loadSharedDictionaryState()).toEqual(STORED);
    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_KEY)).toBe(T1);
  });

  it('later delta pages continue from the last row', async () => {
    await seedStored();
    mockFetchSharedDictionary
      .mockResolvedValueOnce(listPage([entry('e3', 'Widget')], { hasMore: true }))
      .mockResolvedValueOnce(listPage([entry('e1', 'Acme', { deleted_at: T1 })]));

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect(mockFetchSharedDictionary).toHaveBeenNthCalledWith(2, 'ws-1', {
      since: '2026-10-13T00:00:00.000Z',
      sinceId: 'e3',
      limit: 200,
    });
    expect((await loadSharedDictionaryState())?.entries).toEqual({
      e2: { spaceId: 'space-1', word: 'Gizmo' },
      e3: { spaceId: null, word: 'Widget' },
    });
  });

  it('applies hide and unhide deltas', async () => {
    await seedStored({ ...STORED, hiddenIds: ['e1'] });
    mockFetchSharedDictionaryHides.mockResolvedValueOnce(
      hidesPage([hide('e1', { deleted_at: T1 }), hide('e2')]),
    );

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect((await loadSharedDictionaryState())?.hiddenIds).toEqual(['e2']);
  });

  it('never moves a cursor backwards', async () => {
    await seedStored();
    mockFetchSharedDictionary.mockResolvedValueOnce(listPage([], { server_time: T0_MINUS_10S }));

    await pullSharedDictionary();

    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_KEY)).toBe(T0);
  });

  it('scopes prune words of a space the user left', async () => {
    await seedStored();
    mockFetchSharedDictionary.mockResolvedValueOnce(listPage([], { scopes: [scope(null)] }));

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    const state = await loadSharedDictionaryState();
    expect(state?.entries).toEqual({ e1: { spaceId: null, word: 'Acme' } });
    expect(state?.scopes).toEqual([scope(null)]);
  });

  it('stores the paused flag from the last page', async () => {
    await seedStored();
    mockFetchSharedDictionary.mockResolvedValueOnce(listPage([], { paused: true }));

    await pullSharedDictionary();

    expect((await loadSharedDictionaryState())?.paused).toBe(true);
  });

  it('a returning scope triggers a fresh snapshot', async () => {
    await seedStored({ ...STORED, scopes: [scope(null)], entries: { e1: STORED.entries.e1 } });
    mockFetchSharedDictionary
      .mockResolvedValueOnce(listPage([], { scopes: [scope(null), scope('space-1')] }))
      .mockResolvedValueOnce(
        listPage([entry('e1', 'Acme'), entry('e2', 'Gizmo', { space_id: 'space-1' })], {
          server_time: T2,
        }),
      );

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect(mockFetchSharedDictionary).toHaveBeenNthCalledWith(1, 'ws-1', {
      since: T0_MINUS_10S,
      limit: 200,
    });
    expect(mockFetchSharedDictionary).toHaveBeenNthCalledWith(2, 'ws-1', { limit: 200 });
    // Hides are re-snapshotted alongside the entries.
    expect(mockFetchSharedDictionaryHides).toHaveBeenCalledWith('ws-1', { limit: 200 });
    expect((await loadSharedDictionaryState())?.entries).toEqual(STORED.entries);
    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_KEY)).toBe(T2);
  });

  it('expired cursor re-snapshots and drops an entry missing from the snapshot', async () => {
    await seedStored();
    mockFetchSharedDictionary
      .mockRejectedValueOnce(apiError(410, 'SHARED_DICTIONARY_CURSOR_EXPIRED'))
      .mockResolvedValueOnce(listPage([entry('e1', 'Acme')], { server_time: T2 }));

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect(mockFetchSharedDictionary).toHaveBeenNthCalledWith(2, 'ws-1', { limit: 200 });
    expect(mockFetchSharedDictionaryHides).toHaveBeenCalledWith('ws-1', { limit: 200 });
    expect((await loadSharedDictionaryState())?.entries).toEqual({
      e1: { spaceId: null, word: 'Acme' },
    });
    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_KEY)).toBe(T2);
  });

  it('an expired hides cursor re-snapshots the whole pass', async () => {
    await seedStored({ ...STORED, hiddenIds: ['e1'] });
    mockFetchSharedDictionaryHides
      .mockRejectedValueOnce(apiError(410, 'SHARED_DICTIONARY_CURSOR_EXPIRED'))
      .mockResolvedValueOnce(hidesPage([hide('e2')]));
    mockFetchSharedDictionary
      .mockResolvedValueOnce(listPage([]))
      .mockResolvedValueOnce(
        listPage([entry('e1', 'Acme'), entry('e2', 'Gizmo', { space_id: 'space-1' })]),
      );

    await pullSharedDictionary();

    expect(mockFetchSharedDictionaryHides).toHaveBeenNthCalledWith(2, 'ws-1', { limit: 200 });
    expect((await loadSharedDictionaryState())?.hiddenIds).toEqual(['e2']);
  });

  it.each([
    ['NOT_MEMBER', 404, 'SHARED_DICTIONARY_NOT_MEMBER'],
    ['SSO_REQUIRED', 403, 'SSO_REQUIRED'],
  ])('%s clears state', async (_label, status, code) => {
    await seedStored();
    mockFetchSharedDictionary.mockRejectedValueOnce(apiError(status, code));

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect(mockSyncState.has(SHARED_DICTIONARY_STATE_KEY)).toBe(false);
    expect(mockSyncState.has(SHARED_DICTIONARY_CURSOR_KEY)).toBe(false);
    expect(mockSyncState.has(SHARED_DICTIONARY_HIDES_CURSOR_KEY)).toBe(false);
  });

  it('no resolvable workspace clears state', async () => {
    await seedStored();
    mockFetchMyWorkspaces.mockResolvedValue({
      data: [
        { id: 'ws-1', name: 'Acme' },
        { id: 'ws-2', name: 'Other' },
      ],
    });
    mockUsageState.usage = { entitlementSources: { workspaceIds: ['ws-1', 'ws-2'] } };

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: true });

    expect(mockFetchSharedDictionary).not.toHaveBeenCalled();
    expect(await loadSharedDictionaryState()).toBeNull();
    expect(mockSyncState.has(SHARED_DICTIONARY_CURSOR_KEY)).toBe(false);
  });

  it('picks the only entitled workspace from the usage', async () => {
    mockFetchMyWorkspaces.mockResolvedValue({
      data: [
        { id: 'ws-1', name: 'Acme' },
        { id: 'ws-2', name: 'Other' },
      ],
    });
    mockUsageState.usage = { entitlementSources: { workspaceIds: ['ws-2'] } };

    await pullSharedDictionary();

    expect(mockFetchSharedDictionary).toHaveBeenCalledWith('ws-2', { limit: 200 });
    expect((await loadSharedDictionaryState())?.workspaceName).toBe('Other');
  });

  it('keeps the stored state when the usage for several workspaces cannot be read', async () => {
    await seedStored();
    mockFetchMyWorkspaces.mockResolvedValue({
      data: [
        { id: 'ws-1', name: 'Acme' },
        { id: 'ws-2', name: 'Other' },
      ],
    });

    await expect(pullSharedDictionary()).resolves.toEqual({ changed: false });

    expect(mockUsageState.load).toHaveBeenCalled();
    expect(mockFetchSharedDictionary).not.toHaveBeenCalled();
    expect(await loadSharedDictionaryState()).toEqual(STORED);
  });

  it('a different workspace starts a fresh snapshot', async () => {
    await seedStored({ ...STORED, workspaceId: 'ws-old' });

    await pullSharedDictionary();

    expect(mockFetchSharedDictionary).toHaveBeenCalledWith('ws-1', { limit: 200 });
    expect(mockFetchSharedDictionaryHides).toHaveBeenCalledWith('ws-1', { limit: 200 });
    expect((await loadSharedDictionaryState())?.entries).toEqual({});
  });

  it('plain 404 sets the unavailable flag and does not throw', async () => {
    const isolated = loadIsolatedPull();
    await seedStored();
    mockFetchSharedDictionary.mockRejectedValueOnce(apiError(404, undefined, isolated.ApiError));

    await expect(isolated.pull()).resolves.toEqual({ changed: false });
    expect(await loadSharedDictionaryState()).toEqual(STORED);

    // The rest of the session skips the step without a request.
    mockFetchMyWorkspaces.mockClear();
    await expect(isolated.pull()).resolves.toEqual({ changed: false });
    expect(mockFetchMyWorkspaces).not.toHaveBeenCalled();
  });

  it.each([405, 501])('a %i also marks the endpoint unavailable', async (status) => {
    const isolated = loadIsolatedPull();
    mockFetchSharedDictionary.mockRejectedValueOnce(apiError(status, undefined, isolated.ApiError));
    await expect(isolated.pull()).resolves.toEqual({ changed: false });
  });

  it('rethrows other errors', async () => {
    mockFetchSharedDictionary.mockRejectedValueOnce(apiError(500));
    await expect(pullSharedDictionary()).rejects.toThrow('failed');
  });

  it('checks the sync context before writing', async () => {
    const checkpoint = jest.fn();
    await pullSharedDictionary(checkpoint);
    expect(checkpoint).toHaveBeenCalledWith(true);
  });

  it('writes nothing when the sync context is cancelled before the write', async () => {
    await seedStored();
    mockFetchSharedDictionary.mockResolvedValueOnce(listPage([entry('e3', 'Widget')]));
    const checkpoint = jest.fn((upload?: boolean) => {
      if (upload) throw new Error('cancelled');
    });

    await expect(pullSharedDictionary(checkpoint)).rejects.toThrow('cancelled');

    expect(await loadSharedDictionaryState()).toEqual(STORED);
    expect(mockSyncState.get(SHARED_DICTIONARY_CURSOR_KEY)).toBe(T0);
  });
});

describe('resetAllPullCursors', () => {
  it('resetAllPullCursors clears the shared keys', () => {
    for (const key of [
      SHARED_DICTIONARY_CURSOR_KEY,
      SHARED_DICTIONARY_CURSOR_ID_KEY,
      SHARED_DICTIONARY_HIDES_CURSOR_KEY,
      SHARED_DICTIONARY_HIDES_CURSOR_ID_KEY,
    ]) {
      mockSyncState.set(key, 'x');
    }

    resetAllPullCursors();

    expect(mockSyncState.has(SHARED_DICTIONARY_CURSOR_KEY)).toBe(false);
    expect(mockSyncState.has(SHARED_DICTIONARY_CURSOR_ID_KEY)).toBe(false);
    expect(mockSyncState.has(SHARED_DICTIONARY_HIDES_CURSOR_KEY)).toBe(false);
    expect(mockSyncState.has(SHARED_DICTIONARY_HIDES_CURSOR_ID_KEY)).toBe(false);
  });
});
