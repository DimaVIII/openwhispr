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
  const ownsNote = () => {
    if (
      disposed ||
      invalidated ||
      !identityMatches() ||
      useProcessingModeStore.getState().activeMode !== mode
    )
      return false;
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
    ownsNote,
    checkpoint() {
      if (!ownsNote() || controller.signal.aborted) {
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
