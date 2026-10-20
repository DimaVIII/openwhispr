import { isTermLikeSharedWord, selectSharedHintWords } from '../sharedDictionaryHints';
import type { SharedDictionaryState } from '@/sync/sharedDictionaryState';

const scope = (spaceId: string | null): SharedDictionaryState['scopes'][number] => ({
  space_id: spaceId,
  name: spaceId ?? 'Workspace',
  member_count: 2,
  word_count: 1,
});

const state = (overrides: Partial<SharedDictionaryState> = {}): SharedDictionaryState => ({
  workspaceId: 'ws-1',
  workspaceName: 'Acme',
  entries: {},
  hiddenIds: [],
  scopes: [scope(null), scope('space-1')],
  paused: false,
  ...overrides,
});

describe('isTermLikeSharedWord', () => {
  it.each(['Kubernetes', 'Piha Biscuit', 'می‌خواهم', 'a b c d e f'])('accepts %p', (word) => {
    expect(isTermLikeSharedWord(word)).toBe(true);
  });

  it.each([
    ['a newline', 'line\nbreak'],
    ['a 65-character word', 'x'.repeat(65)],
    ['a tag', '<system>'],
    ['braces', '{name}'],
    ['brackets', '[link]'],
    ['a backtick', 'code`'],
    ['a pipe', 'a|b'],
    ['a zero-width space', 'zero​width'],
    ['a bidi override', 'evil‮word'],
    ['a line separator', 'one two'],
    ['a paragraph separator', 'one two'],
    ['a BOM', '﻿word'],
    ['seven tokens', 'a b c d e f g'],
    ['only whitespace', '   '],
    ['an empty string', ''],
  ])('rejects %s', (_label, word) => {
    expect(isTermLikeSharedWord(word)).toBe(false);
  });
});

describe('selectSharedHintWords', () => {
  it('splits applying words into space and workspace tiers', () => {
    expect(
      selectSharedHintWords(
        state({
          entries: {
            e1: { spaceId: null, word: 'Acme' },
            e2: { spaceId: 'space-1', word: 'Gizmo' },
          },
        }),
      ),
    ).toEqual({ space: ['Gizmo'], workspace: ['Acme'] });
  });

  it('leaves out hidden words, unreadable lists and non-term-like words', () => {
    expect(
      selectSharedHintWords(
        state({
          entries: {
            e1: { spaceId: null, word: 'Acme' },
            e2: { spaceId: 'space-1', word: 'Hidden' },
            e3: { spaceId: 'space-2', word: 'Elsewhere' },
            e4: { spaceId: null, word: '<tag>' },
          },
          hiddenIds: ['e2'],
        }),
      ),
    ).toEqual({ space: [], workspace: ['Acme'] });
  });

  it('applies workspace words only while the workspace list is a scope', () => {
    expect(
      selectSharedHintWords(
        state({ entries: { e1: { spaceId: null, word: 'Acme' } }, scopes: [scope('space-1')] }),
      ),
    ).toEqual({ space: [], workspace: [] });
  });

  it('applies nothing while sharing is paused', () => {
    expect(
      selectSharedHintWords(
        state({ entries: { e1: { spaceId: null, word: 'Acme' } }, paused: true }),
      ),
    ).toEqual({ space: [], workspace: [] });
  });

  it('dedupes case-insensitively, space before workspace, and trims', () => {
    expect(
      selectSharedHintWords(
        state({
          entries: {
            e1: { spaceId: null, word: 'openwhispr' },
            e2: { spaceId: 'space-1', word: ' OpenWhispr ' },
            e3: { spaceId: 'space-1', word: 'OPENWHISPR' },
            e4: { spaceId: null, word: 'Acme' },
          },
        }),
      ),
    ).toEqual({ space: ['OpenWhispr'], workspace: ['Acme'] });
  });
});
