import type { SharedDictionaryState } from '@/sync/sharedDictionaryState';

export interface SharedHintWords {
  space: string[];
  workspace: string[];
}

// Ported from desktop src/utils/sharedDictionaryHints.ts; mobile keeps its own copy.
const MAX_SHARED_WORD_LENGTH = 64;
const MAX_SHARED_WORD_TOKENS = 6;
// Control, invisible format (zero-width, bidi overrides, BOM) and line or
// paragraph separator characters, plus the characters that open markup,
// templates, fences or tables in a prompt. ZWNJ and ZWJ stay: Persian, Urdu and
// Indic words are spelled with them.
const NOT_TERM_LIKE = /(?![‌‍])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>{}[\]`|]/u;

/**
 * Teammates' words reach transcription and LLM prompts, so only words that look
 * like dictionary terms do: a short name or phrase, never something shaped like
 * an instruction or markup.
 */
export function isTermLikeSharedWord(word: string): boolean {
  // Checked before trimming: trim() would strip a BOM or a trailing line break.
  if (NOT_TERM_LIKE.test(word)) return false;
  const term = word.trim();
  if (term.length < 1 || term.length > MAX_SHARED_WORD_LENGTH) return false;
  return term.split(/\s+/u).length <= MAX_SHARED_WORD_TOKENS;
}

/**
 * The shared words that apply to this member, split by tier: live, not hidden,
 * in a list the server names in `scopes`, and term-like. Nothing applies while
 * sharing is paused. Deduped case-insensitively, space words first, so a word
 * in both a space and the workspace list counts once, at space priority.
 */
export function selectSharedHintWords(state: SharedDictionaryState | null): SharedHintWords {
  const hints: SharedHintWords = { space: [], workspace: [] };
  if (!state || state.paused) return hints;

  const hidden = new Set(state.hiddenIds);
  const readableSpaces = new Set<string>();
  let workspaceReadable = false;
  for (const scope of state.scopes) {
    if (scope.space_id === null) workspaceReadable = true;
    else readableSpaces.add(scope.space_id);
  }

  const applying = Object.entries(state.entries).filter(([id, entry]) => {
    if (hidden.has(id) || !isTermLikeSharedWord(entry.word)) return false;
    return entry.spaceId === null ? workspaceReadable : readableSpaces.has(entry.spaceId);
  });

  const seen = new Set<string>();
  const add = (tier: string[], word: string): void => {
    const lower = word.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    tier.push(word);
  };
  for (const [, entry] of applying) {
    if (entry.spaceId !== null) add(hints.space, entry.word.trim());
  }
  for (const [, entry] of applying) {
    if (entry.spaceId === null) add(hints.workspace, entry.word.trim());
  }
  return hints;
}
