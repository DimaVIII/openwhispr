// Per-provider budgets for the custom-dictionary transcription prompt.
// Groq rejects prompts > 896 chars (also via a custom endpoint); 890 leaves margin.
export const GROQ_PROMPT_CHARS = 890;
// Whisper-family decoders read at most 223 prompt tokens and keep the tail of
// anything longer; 900 chars bounds the request without deciding which words survive.
export const WHISPER_PROMPT_CHARS = 900;
// gpt-4o-transcribe models are LLMs with a 16k context; this guards against an
// absurd list crowding out a long dictation, not a limit anyone should hit.
export const TRANSCRIBE_PROMPT_CHARS = 8000;

export function dictionaryPromptLimit(input: {
  providerId: string;
  endpoint: string;
  modelId: string;
}): number {
  if (input.providerId === 'groq' || new URL(input.endpoint).hostname === 'api.groq.com') {
    return GROQ_PROMPT_CHARS;
  }
  if (input.modelId.toLowerCase().startsWith('gpt-4o')) return TRANSCRIBE_PROMPT_CHARS;
  return WHISPER_PROMPT_CHARS;
}

// Builds the dictionary prompt from priority tiers (personal, space, workspace).
// Whole words are kept greedily, highest tier first, so a long shared list can
// only ever crowd out lower-priority words. They are emitted lowest tier first:
// Whisper-family decoders keep the TAIL of an over-long prompt, so the user's
// own words belong there. A personal-only list that fits is the plain
// ", "-joined string it always was. Ported from desktop dictionaryPromptCap.js.
export function formatDictionaryPrompt(tiers: string[][], maxChars: number): string {
  const kept: string[][] = tiers.map(() => []);
  let length = 0;
  let count = 0;
  let full = false;
  for (let tier = 0; tier < tiers.length && !full; tier++) {
    for (const word of tiers[tier]) {
      const next = length + word.length + (count > 0 ? 2 : 0);
      // Strict priority: the first word that doesn't fit ends the fill.
      if (next > maxChars) {
        full = true;
        break;
      }
      length = next;
      count++;
      kept[tier].push(word);
    }
  }
  return kept.reverse().flat().join(', ');
}

// For prompts the app never trimmed before shared words existed: shared words
// fill up to `maxChars`, but the personal tier (tiers[0]) is always sent whole.
export function promptLimitKeepingPersonal(tiers: string[][], maxChars: number): number {
  return Math.max(maxChars, (tiers[0] ?? []).join(', ').length);
}
