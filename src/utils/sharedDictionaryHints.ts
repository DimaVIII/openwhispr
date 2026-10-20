import type { SharedDictionarySnapshot } from "../types/sharedDictionary";

export interface SharedHintWords {
  space: string[];
  workspace: string[];
}

export const EMPTY_SHARED_HINTS: SharedHintWords = { space: [], workspace: [] };

const MAX_SHARED_WORD_LENGTH = 64;
const MAX_SHARED_WORD_TOKENS = 6;
// Control, invisible format (zero-width, bidi overrides, BOM) and line or
// paragraph separator characters, plus the characters that open markup,
// templates, fences or tables in a prompt.
const NOT_TERM_LIKE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>{}[\]`|]/u;

/**
 * Teammates' words reach transcription and LLM system prompts, so only words
 * that look like dictionary terms do: a short name or phrase, never something
 * shaped like an instruction or markup. The Dictionary page still lists the rest.
 */
export function isTermLikeSharedWord(word: string): boolean {
  // Checked before trimming: trim() would strip a BOM or a trailing line break.
  if (NOT_TERM_LIKE.test(word)) return false;
  const term = word.trim();
  if (term.length < 1 || term.length > MAX_SHARED_WORD_LENGTH) return false;
  return term.split(/\s+/u).length <= MAX_SHARED_WORD_TOKENS;
}

/**
 * The shared words that may reach the STT prompt: live, term-like entries the
 * member can still read and has not hidden. Everything is empty while sharing
 * is paused or before the first sync pass, so the prompt never carries words
 * the workspace has switched off.
 */
export function selectSharedHintWords(snapshot: SharedDictionarySnapshot): SharedHintWords {
  const { meta } = snapshot;
  if (!meta || meta.paused) return { space: [], workspace: [] };

  const hidden = new Set(snapshot.hiddenIds);
  const readableSpaces = new Set<string>();
  let workspaceReadable = false;
  for (const scope of meta.scopes) {
    if (scope.space_id === null) workspaceReadable = true;
    else readableSpaces.add(scope.space_id);
  }

  const space: string[] = [];
  const workspace: string[] = [];
  for (const entry of snapshot.entries) {
    if (hidden.has(entry.cloudId) || !isTermLikeSharedWord(entry.word)) continue;
    const word = entry.word.trim();
    if (entry.spaceId === null) {
      if (workspaceReadable) workspace.push(word);
    } else if (readableSpaces.has(entry.spaceId)) {
      space.push(word);
    }
  }
  return { space, workspace };
}
