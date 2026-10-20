import { useDictionaryStore } from '@/store/useDictionaryStore';
import { useSharedDictionaryStore } from '@/store/useSharedDictionaryStore';
import { useSnippetsStore } from '@/store/useSnippetsStore';
import type { TranscriptionRequest } from '@/types';
import {
  getDictionaryHintTiers,
  MAX_SHARED_WORDS_IN_LLM_PROMPTS,
  withSharedCapped,
} from './snippets';

// Snippet expansion and snippet-trigger hints apply to spoken dictation only —
// not to uploaded files (or meeting diarization). Mirrors desktop, which expands
// only in its dictation hook.
export function isDictationContext(
  requestContext: TranscriptionRequest['requestContext'],
): boolean {
  return requestContext === 'recording' || requestContext === 'keyboard';
}

// Dictionary hints in priority order: [personal + snippet triggers, space,
// workspace]. Snippet triggers (dictation contexts only) ride with personal
// words so they survive transcription and cleanup; only they are gated by
// `includeSnippetTriggers`. Shared words are deduped against higher tiers.
export function buildDictationHintTiers(includeSnippetTriggers: boolean): string[][] {
  const dict = useDictionaryStore.getState();
  const customDictionary = dict.isLoaded ? dict.entries.map((e) => e.word) : [];
  const snippetState = useSnippetsStore.getState();
  const snippets = snippetState.isLoaded ? snippetState.entries : [];
  const shared = useSharedDictionaryStore.getState().hints;
  return getDictionaryHintTiers(customDictionary, snippets, shared, includeSnippetTriggers);
}

// The ranked hints as one list, personal words first.
export function buildDictationHints(includeSnippetTriggers: boolean): string[] {
  return buildDictationHintTiers(includeSnippetTriggers).flat();
}

// Hints for LLM prompts (cleanup, the voice assistant, note actions): every
// personal word, at most MAX_SHARED_WORDS_IN_LLM_PROMPTS shared ones.
export function buildLlmDictionaryHints(includeSnippetTriggers: boolean): string[] {
  return withSharedCapped(
    buildDictationHintTiers(includeSnippetTriggers),
    MAX_SHARED_WORDS_IN_LLM_PROMPTS,
  );
}

// The words the dictionary effectively contains — personal, then the shared
// words that apply, no snippet triggers — so correction learning never learns a
// team word into the personal list.
export function buildEffectiveDictionaryWords(): string[] {
  return buildDictationHints(false);
}
