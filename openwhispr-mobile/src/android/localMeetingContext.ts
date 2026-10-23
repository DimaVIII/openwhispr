import { useAuthStore } from '@/store/useAuthStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';
import { notesRepository } from '@/data';

/** Observe transitions, including A -> B -> A, for the whole asynchronous job. */
export function createLocalMeetingContext(noteId: number, signal?: AbortSignal) {
  const owner = useAuthStore.getState();
  const userId = owner.user?.id;
  const cookie = owner.sessionCookie;
  const mode = useProcessingModeStore.getState().activeMode;
  const privateNote = notesRepository.getNoteById(noteId)?.isPrivate === 1;
  let invalidated = false;
  let identityInvalidated = false;
  let disposed = false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const identityMatches = () => {
    const current = useAuthStore.getState();
    return current.user?.id === userId && current.sessionCookie === cookie;
  };
  const unsubscribeAuth = useAuthStore.subscribe(() => {
    if (!identityMatches()) {
      identityInvalidated = true;
      invalidated = true;
      cancel();
    }
  });
  const unsubscribeMode = useProcessingModeStore.subscribe((state) => {
    if (state.activeMode !== mode) {
      invalidated = true;
      cancel();
    }
  });
  // Only for retaining audio / marking an interrupted recording retryable.
  // A mode change stops processing but does not transfer ownership of the saved note.
  const ownsSavedNote = () => {
    if (disposed || identityInvalidated || !identityMatches()) return false;
    const note = notesRepository.getNoteById(noteId);
    return (
      !!note &&
      !note.deletedAt &&
      note.noteType === 'meeting' &&
      (note.isPrivate === 1) === privateNote
    );
  };
  return {
    signal: controller.signal,
    ownsSavedNote,
    ownsNote: () =>
      !invalidated && useProcessingModeStore.getState().activeMode === mode && ownsSavedNote(),
    checkpoint() {
      if (
        invalidated ||
        useProcessingModeStore.getState().activeMode !== mode ||
        !ownsSavedNote() ||
        controller.signal.aborted
      ) {
        throw Object.assign(new Error('Meeting processing cancelled.'), { name: 'AbortError' });
      }
    },
    dispose() {
      disposed = true;
      signal?.removeEventListener('abort', cancel);
      unsubscribeAuth();
      unsubscribeMode();
    },
  };
}
