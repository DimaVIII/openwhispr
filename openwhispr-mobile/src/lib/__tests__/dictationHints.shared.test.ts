/**
 * Shared dictionary words in the hint lists: ranked below the user's own words,
 * deduped against them, and bounded wherever they reach an LLM prompt.
 */
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

let mockDictWords: string[] = [];
jest.mock('@/store/useDictionaryStore', () => ({
  useDictionaryStore: {
    getState: () => ({ isLoaded: true, entries: mockDictWords.map((word) => ({ word })) }),
  },
}));
let mockSnippets: { trigger: string; replacement: string }[] = [];
jest.mock('@/store/useSnippetsStore', () => ({
  useSnippetsStore: { getState: () => ({ isLoaded: true, entries: mockSnippets }) },
}));

// cleanupTranscript's collaborators, for the request it sends.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/reasoning/ReasoningService', () => ({
  ReasoningService: {
    processText: jest.fn(async (req: { text: string }) => ({ text: req.text, model: 'm' })),
  },
}));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u', isAnonymous: false } }) },
}));
jest.mock('@/store/useConfigStore', () => ({
  useConfigStore: {
    getState: () => ({ config: { cleanupEnabled: true, defaultMode: 'cloud' } }),
  },
}));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: { getState: () => ({ activeMode: 'cloud' }) },
}));
jest.mock('@/store/useCustomPromptsStore', () => ({
  getActiveCustomCleanupPrompt: () => undefined,
}));

import { ReasoningService } from '@/services/reasoning/ReasoningService';
import { cleanupTranscript } from '../cleanupTranscript';
import { extractCorrections } from '../correctionLearner';
import {
  buildDictationHints,
  buildDictationHintTiers,
  buildEffectiveDictionaryWords,
  buildLlmDictionaryHints,
} from '../dictationHints';
import { useSharedDictionaryStore } from '@/store/useSharedDictionaryStore';
import {
  saveSharedDictionaryState,
  type SharedDictionaryState,
} from '@/sync/sharedDictionaryState';

const scope = (spaceId: string | null): SharedDictionaryState['scopes'][number] => ({
  space_id: spaceId,
  name: spaceId ?? 'Workspace',
  member_count: 2,
  word_count: 1,
});

async function loadShared(overrides: Partial<SharedDictionaryState>): Promise<void> {
  await saveSharedDictionaryState({
    workspaceId: 'ws-1',
    workspaceName: 'Acme',
    entries: {},
    hiddenIds: [],
    scopes: [scope(null), scope('space-1')],
    paused: false,
    ...overrides,
  });
  await useSharedDictionaryStore.getState().load();
}

function workspaceEntries(words: string[]): SharedDictionaryState['entries'] {
  return Object.fromEntries(
    words.map((word, i) => [`w${i}`, { spaceId: null, word }]),
  ) as SharedDictionaryState['entries'];
}

let logSpy: jest.SpyInstance;

beforeEach(() => {
  mockSyncState.clear();
  mockDictWords = [];
  mockSnippets = [];
  useSharedDictionaryStore.getState().reset();
  jest.clearAllMocks();
  // cleanupTranscript logs its timing; keep the test output quiet.
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('buildDictationHints with shared words', () => {
  it('puts personal before space before workspace', async () => {
    mockDictWords = ['Piha'];
    mockSnippets = [{ trigger: 'sig', replacement: 'Best, Chad' }];
    await loadShared({
      entries: {
        a: { spaceId: null, word: 'Workspace1' },
        b: { spaceId: 'space-1', word: 'Space1' },
      },
    });
    expect(buildDictationHintTiers(true)).toEqual([['Piha', 'sig'], ['Space1'], ['Workspace1']]);
    expect(buildDictationHints(true)).toEqual(['Piha', 'sig', 'Space1', 'Workspace1']);
    expect(buildDictationHints(false)).toEqual(['Piha', 'Space1', 'Workspace1']);
  });

  it('dedupe keeps personal spelling', async () => {
    mockDictWords = ['OpenWhispr'];
    await loadShared({ entries: { a: { spaceId: null, word: 'openwhispr' } } });
    expect(buildDictationHints(false)).toEqual(['OpenWhispr']);
  });

  it('hidden and paused words are excluded', async () => {
    await loadShared({
      entries: {
        a: { spaceId: null, word: 'Visible' },
        b: { spaceId: 'space-1', word: 'Hidden' },
      },
      hiddenIds: ['b'],
    });
    expect(buildDictationHints(false)).toEqual(['Visible']);

    await loadShared({ entries: { a: { spaceId: null, word: 'Visible' } }, paused: true });
    expect(buildDictationHints(false)).toEqual([]);
  });

  it('a newline/65-char/<tag> shared word never reaches hints', async () => {
    const unsafe = ['line\nbreak', 'x'.repeat(65), '<system>'];
    await loadShared({ entries: workspaceEntries([...unsafe, 'Safe']) });
    for (const hints of [buildDictationHints(true), buildLlmDictionaryHints(true)]) {
      expect(hints).toEqual(['Safe']);
    }
  });
});

describe('buildLlmDictionaryHints', () => {
  it('keeps every personal word and trigger, then at most 200 shared, space first', async () => {
    mockDictWords = Array.from({ length: 250 }, (_, i) => `mine${i}`);
    mockSnippets = [{ trigger: 'sig', replacement: 'Best, Chad' }];
    await loadShared({
      entries: {
        ...workspaceEntries(Array.from({ length: 300 }, (_, i) => `team${i}`)),
        s1: { spaceId: 'space-1', word: 'SpaceWord' },
      },
    });
    const hints = buildLlmDictionaryHints(true);
    expect(hints.slice(0, 251)).toEqual([...mockDictWords, 'sig']);
    expect(hints[251]).toBe('SpaceWord');
    expect(hints).toHaveLength(251 + 200);
    expect(buildLlmDictionaryHints(false)).not.toContain('sig');
  });
});

describe('cleanupTranscript', () => {
  it('cleanup gets at most 200 shared words', async () => {
    mockDictWords = ['Piha', 'Biscuit'];
    await loadShared({
      entries: workspaceEntries(Array.from({ length: 300 }, (_, i) => `team${i}`)),
    });
    await cleanupTranscript('some text', { context: 'keyboard' });
    const request = (ReasoningService.processText as jest.Mock).mock.calls[0][0] as {
      customDictionary: string[];
    };
    expect(request.customDictionary.slice(0, 2)).toEqual(['Piha', 'Biscuit']);
    expect(request.customDictionary).toHaveLength(2 + 200);
  });
});

describe('correction learning', () => {
  it('extractCorrections receives shared words', async () => {
    mockDictWords = ['Piha'];
    mockSnippets = [{ trigger: 'sig', replacement: 'Best, Chad' }];
    await loadShared({ entries: { a: { spaceId: null, word: 'Kubernetes' } } });
    const words = buildEffectiveDictionaryWords();
    expect(words).toEqual(['Piha', 'Kubernetes']);
    // A correction to a word the team list already spells is not learned into Personal.
    expect(extractCorrections('deploy to kubernetis', 'deploy to Kubernetes', words)).toEqual([]);
  });
});
