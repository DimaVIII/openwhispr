import type { SharedDictionarySnapshot } from "../types/sharedDictionary";

export interface SharedHintWords {
  space: string[];
  workspace: string[];
}

export const EMPTY_SHARED_HINTS: SharedHintWords = { space: [], workspace: [] };

/**
 * The shared words that may reach the STT prompt: live entries the member can
 * still read and has not hidden. Everything is empty while sharing is paused or
 * before the first sync pass, so the prompt never carries words the workspace
 * has switched off.
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
    if (hidden.has(entry.cloudId)) continue;
    if (entry.spaceId === null) {
      if (workspaceReadable) workspace.push(entry.word);
    } else if (readableSpaces.has(entry.spaceId)) {
      space.push(entry.word);
    }
  }
  return { space, workspace };
}
