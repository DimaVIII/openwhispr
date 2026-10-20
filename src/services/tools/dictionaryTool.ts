import logger from "../../utils/logger";
import type { ToolDefinition, ToolResult } from "./ToolRegistry";

export interface SharedDictionaryWord {
  id: string;
  word: string;
}

export interface DictionaryActions {
  getDictionary(): string[];
  updateDictionary(changes: { add: string[]; remove: string[] }): void;
  // Shared words that apply to the user right now. Async because the shared
  // mirror lives in the main process, behind IPC.
  getSharedWords(): Promise<SharedDictionaryWord[]>;
  // A teammate's word is only ever hidden for the user, never deleted.
  hideSharedWords(ids: string[]): Promise<void>;
}

export const cleanWordList = (values: unknown): string[] =>
  Array.isArray(values)
    ? [
        ...new Set(
          values
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ]
    : [];

const quoteList = (words: string[]) => words.map((word) => `"${word}"`).join(", ");

export function createUpdateDictionaryTool(actions: DictionaryActions): ToolDefinition {
  return {
    name: "update_dictionary",
    description:
      "Add words to or remove words from the user's custom dictionary: the names, jargon, and terms transcription must spell exactly. To fix a spelling, remove the old word and add the corrected one in the same call. Words a teammate shared with the team are not the user's to delete: removing one only hides it for the user.",
    parameters: {
      type: "object",
      properties: {
        add: {
          type: "array",
          items: { type: "string" },
          description: "Words or short phrases to add",
        },
        remove: {
          type: "array",
          items: { type: "string" },
          description: "Existing dictionary words to remove",
        },
      },
      additionalProperties: false,
    },
    readOnly: false,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const personal = new Set(actions.getDictionary().map((word) => word.toLowerCase()));
      const sharedEntries = await actions.getSharedWords();
      const sharedIdsByWord = new Map<string, string[]>();
      for (const { id, word } of sharedEntries) {
        const key = word.toLowerCase();
        sharedIdsByWord.set(key, [...(sharedIdsByWord.get(key) ?? []), id]);
      }
      const inPersonal = (word: string) => personal.has(word.toLowerCase());
      const inShared = (word: string) => sharedIdsByWord.has(word.toLowerCase());
      const has = (word: string) => inPersonal(word) || inShared(word);

      const requestedAdd = cleanWordList(args.add);
      const requestedRemove = cleanWordList(args.remove);
      // Added words always land in Personal; one a teammate already shares counts as present.
      const add = requestedAdd.filter((word) => !has(word));
      const alreadyPresent = requestedAdd.filter(has);
      const remove = requestedRemove.filter(inPersonal);
      // Independent of Personal: a shared copy keeps applying after the Personal one goes.
      const hidden = requestedRemove.filter(inShared);
      const notFound = requestedRemove.filter((word) => !has(word));

      if (add.length === 0 && remove.length === 0 && hidden.length === 0) {
        const reasons = [
          notFound.length ? `Not in the dictionary: ${quoteList(notFound)}` : "",
          alreadyPresent.length ? `Already in the dictionary: ${quoteList(alreadyPresent)}` : "",
        ].filter(Boolean);
        return {
          success: false,
          data: null,
          displayText: reasons.join(". ") || "Nothing to change",
        };
      }

      if (hidden.length > 0) {
        const ids = hidden.flatMap((word) => sharedIdsByWord.get(word.toLowerCase()) ?? []);
        try {
          await actions.hideSharedWords(ids);
        } catch (error) {
          logger.warn(
            "Failed to hide shared dictionary words for the assistant",
            { error: (error as Error)?.message },
            "dictionary"
          );
          const appliedCount = (error as { appliedCount?: number } | null)?.appliedCount ?? 0;
          return {
            success: false,
            data: null,
            displayText:
              `Could not hide ${quoteList(hidden)} from the shared dictionary. ` +
              (appliedCount > 0
                ? "Some were hidden; the rest of the request was not applied"
                : "Nothing was changed"),
          };
        }
      }

      if (add.length > 0 || remove.length > 0) actions.updateDictionary({ add, remove });
      const isHidden = new Set(hidden.map((word) => word.toLowerCase()));
      const removedAndHidden = remove.filter((word) => isHidden.has(word.toLowerCase()));
      const removedOnly = remove.filter((word) => !isHidden.has(word.toLowerCase()));
      const hiddenOnly = hidden.filter((word) => !inPersonal(word));
      const summary = [
        add.length ? `Added ${quoteList(add)}` : "",
        removedOnly.length ? `Removed ${quoteList(removedOnly)}` : "",
        removedAndHidden.length
          ? `Removed ${quoteList(removedAndHidden)} and hid the shared copy for you`
          : "",
        hiddenOnly.length
          ? `Hidden for you ${quoteList(hiddenOnly)} (shared with your team, so it stays for them)`
          : "",
      ].filter(Boolean);
      return {
        success: true,
        data: { added: add, removed: remove, hidden, alreadyPresent, notFound },
        displayText: summary.join("; "),
      };
    },
  };
}
