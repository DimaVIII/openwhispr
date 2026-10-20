import { notesRepository } from '@/data';
import type { RemoteSharedScope } from '@/data/remote/sharedDictionaryApi';

export const SHARED_DICTIONARY_STATE_KEY = 'shared_dictionary.state';

/**
 * The active workspace's shared lists as last pulled, kept whole in one
 * sync_state row: mobile only applies them, and the data is small and always
 * read in full. `entries` holds live words only, keyed by their cloud id.
 */
export interface SharedDictionaryState {
  workspaceId: string;
  workspaceName: string;
  entries: Record<string, { spaceId: string | null; word: string }>;
  hiddenIds: string[];
  scopes: RemoteSharedScope[];
  paused: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is SharedDictionaryState['entries'][string] {
  return (
    isRecord(value) &&
    typeof value.word === 'string' &&
    (value.spaceId === null || typeof value.spaceId === 'string')
  );
}

function isScope(value: unknown): value is RemoteSharedScope {
  return isRecord(value) && (value.space_id === null || typeof value.space_id === 'string');
}

// A row this build can't read is treated as no state: the next pull, finding
// no state, re-snapshots and rewrites it.
function parseState(raw: string): SharedDictionaryState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.workspaceId !== 'string' ||
    typeof value.workspaceName !== 'string' ||
    !isRecord(value.entries) ||
    !Object.values(value.entries).every(isEntry) ||
    !Array.isArray(value.hiddenIds) ||
    !value.hiddenIds.every((id) => typeof id === 'string') ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every(isScope) ||
    typeof value.paused !== 'boolean'
  ) {
    return null;
  }
  return value as unknown as SharedDictionaryState;
}

export async function loadSharedDictionaryState(): Promise<SharedDictionaryState | null> {
  const raw = notesRepository.getSyncState(SHARED_DICTIONARY_STATE_KEY);
  return raw ? parseState(raw) : null;
}

export async function saveSharedDictionaryState(
  state: SharedDictionaryState | null,
): Promise<void> {
  if (state) notesRepository.setSyncState(SHARED_DICTIONARY_STATE_KEY, JSON.stringify(state));
  else notesRepository.clearSyncState(SHARED_DICTIONARY_STATE_KEY);
}
