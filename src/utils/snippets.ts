import type { SharedHintWords } from "./sharedDictionaryHints";

export interface Snippet {
  trigger: string;
  replacement: string;
}

// Mirrors the cap database.js enforces when it stores snippets.
export const MAX_SNIPPET_TRIGGER_LENGTH = 100;

interface SnippetMatcher {
  regex: RegExp;
  replacements: Map<string, string>;
}

export interface SnippetTriggerRange {
  /** Index of the trigger's first character. */
  start: number;
  /** Index one past the trigger's last character. */
  end: number;
}

let cachedSnippets: Snippet[] | null = null;
let cachedMatcher: SnippetMatcher | null = null;

// The regex /i flag can't case-fold Turkish İ (U+0130) or dotless ı
// (U+0131), and İ's toLowerCase() form is two code units ("i" + U+0307), so
// triggers like "İmza" never matched. Folding İ to a plain "i" gives Map
// keys a canonical form, and matching İ/ı explicitly in the pattern lets the
// regex find them in the transcript.
function foldCapitalIDot(value: string): string {
  return value.replace(/İ/g, "i");
}

function buildMatcher(snippets: Snippet[]): SnippetMatcher | null {
  const replacements = new Map<string, string>();
  for (const { trigger, replacement } of snippets) {
    const folded = foldCapitalIDot(trigger.trim().normalize("NFC"));
    const key = folded.toLowerCase();
    if (!key) continue;
    replacements.set(key, replacement);
    // An uppercase I in the trigger may mean Turkish ı as well as English i,
    // so register both readings; an explicit trigger wins over a variant.
    const dotlessKey = folded.replace(/I/g, "ı").toLowerCase();
    if (!replacements.has(dotlessKey)) replacements.set(dotlessKey, replacement);
  }
  if (replacements.size === 0) return null;

  // Longest-first so "investor ask" wins over a shorter "ask" trigger.
  const escaped = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((t) => t.replace(/i/g, "[iİ]").replace(/ı/g, "[ıI]"));
  // Unicode-aware word boundaries — triggers never match inside a word.
  const regex = new RegExp(
    `(?<=^|[\\s\\p{P}\\p{S}])(?:${escaped.join("|")})(?=$|[\\s\\p{P}\\p{S}])`,
    "giu"
  );
  return { regex, replacements };
}

// Memoized against the snippets array reference (the settings store replaces
// the array on every change).
function getMatcher(snippets?: Snippet[] | null): SnippetMatcher | null {
  if (!Array.isArray(snippets) || snippets.length === 0) return null;
  if (snippets !== cachedSnippets) {
    cachedSnippets = snippets;
    cachedMatcher = buildMatcher(snippets);
  }
  return cachedMatcher;
}

// The pattern case-folds the Unicode way (/iu) while the keys are toLowerCase'd,
// so a match is not proof of a replacement: "[ıI]mza" matches a plain "imza",
// which is no key at all. Both callers resolve through here, so a reported range
// always means an expansion — wake-word suppression depends on it.
function resolveReplacement(match: string, replacements: Map<string, string>): string | undefined {
  const folded = foldCapitalIDot(match);
  return (
    replacements.get(folded.toLowerCase()) ??
    // An uppercase I can be capital dotless ı as well as English i.
    replacements.get(folded.replace(/I/g, "ı").toLowerCase())
  );
}

/**
 * Character ranges of every trigger occurrence, matched against `text` exactly
 * as given so the offsets index that same string. Wake-word detection uses
 * these to ignore an agent name that only appears because it opens a trigger
 * the user chose, such as "openwhispr review" (see `agentDetection`).
 */
export function findSnippetTriggerRanges(
  text: string,
  snippets?: Snippet[] | null
): SnippetTriggerRange[] {
  if (!text) return [];
  const matcher = getMatcher(snippets);
  if (!matcher) return [];
  return [...text.matchAll(matcher.regex)]
    .filter((match) => resolveReplacement(match[0], matcher.replacements) !== undefined)
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
}

/**
 * Replace every spoken trigger with its saved text in a single pass.
 */
export function expandSnippets(text: string, snippets?: Snippet[] | null): string {
  if (!text) return text;
  const matcher = getMatcher(snippets);
  if (!matcher) return text;
  const { regex, replacements } = matcher;
  // NFC so a decomposed "I" + U+0307 in the transcript recombines into İ.
  return text
    .normalize("NFC")
    .replace(regex, (match) => resolveReplacement(match, replacements) ?? match);
}

interface DictionaryHintSettings {
  customDictionary?: string[] | null;
  snippets?: Snippet[] | null;
  sharedDictionaryHints?: SharedHintWords | null;
}

function wordList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((w): w is string => typeof w === "string") : [];
}

// Shared words never repeat a word seen in a higher tier (or earlier in their
// own); case-insensitive so the user's own spelling wins over a teammate's.
function dedupeBelow(words: string[], seen: Set<string>): string[] {
  const kept: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(word);
  }
  return kept;
}

function sharedTiers(
  settings: DictionaryHintSettings | null | undefined,
  personal: string[]
): [string[], string[]] {
  const seen = new Set(wordList(personal).map((word) => word.toLowerCase()));
  const space = dedupeBelow(wordList(settings?.sharedDictionaryHints?.space), seen);
  const workspace = dedupeBelow(wordList(settings?.sharedDictionaryHints?.workspace), seen);
  return [space, workspace];
}

/**
 * Hint words in priority order: [personal + snippet triggers, space, workspace].
 * Snippet triggers rank with personal words so they survive both the STT prompt
 * and the cleanup-model suffix. The personal tier is returned as saved (no
 * dedupe) so a list without shared words is exactly what it always was.
 */
export function getDictionaryHintTiers(settings?: DictionaryHintSettings | null): string[][] {
  const dictionary = Array.isArray(settings?.customDictionary) ? settings.customDictionary : [];
  const snippets = Array.isArray(settings?.snippets) ? settings.snippets : [];
  const triggers = snippets
    .map((s) => s?.trigger)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  const personal = [...dictionary, ...triggers];
  return [personal, ...sharedTiers(settings, personal)];
}

/**
 * Dictionary words plus snippet triggers — the hint list fed to the STT
 * prompt and cleanup-model dictionary suffix so triggers survive both.
 */
export function getDictionaryHintWords(settings?: DictionaryHintSettings | null): string[] {
  return getDictionaryHintTiers(settings).flat();
}

/**
 * The words the user's dictionary effectively contains, for counts and display:
 * personal, then space, then workspace, without snippet triggers.
 */
export function getEffectiveDictionaryWords(settings?: DictionaryHintSettings | null): string[] {
  const personal = Array.isArray(settings?.customDictionary) ? settings.customDictionary : [];
  return [personal, ...sharedTiers(settings, personal)].flat();
}
