let mockIdentity = { user: { id: 'a' }, sessionCookie: 'cookie' };
let mockMode = 'private';
let mockNote = { id: 7, isPrivate: 1, noteType: 'meeting', deletedAt: null as string | null };
let mockAccountChanged: () => void;
let mockModeChanged: (state: { activeMode: string }) => void;
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => mockIdentity,
    subscribe: (callback: () => void) => {
      mockAccountChanged = callback;
      return jest.fn();
    },
  },
}));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: {
    getState: () => ({ activeMode: mockMode }),
    subscribe: (callback: typeof mockModeChanged) => {
      mockModeChanged = callback;
      return jest.fn();
    },
  },
}));
jest.mock('@/data', () => ({ notesRepository: { getNoteById: () => mockNote } }));
import { createLocalMeetingContext } from '../localMeetingContext';
beforeEach(() => {
  mockIdentity = { user: { id: 'a' }, sessionCookie: 'cookie' };
  mockMode = 'private';
  mockNote = { id: 7, isPrivate: 1, noteType: 'meeting', deletedAt: null };
});
it('allows marking the same account recording retryable after a mode switch, but blocks processing', () => {
  const context = createLocalMeetingContext(7);
  mockMode = 'cloud';
  mockModeChanged({ activeMode: mockMode });
  expect(context.signal.aborted).toBe(true);
  expect(context.ownsNote()).toBe(false);
  expect(context.ownsSavedNote()).toBe(true);
  context.dispose();
  expect(context.ownsSavedNote()).toBe(false);
});
it('never grants saved-note writes after account A to B to A, privacy change or deletion', () => {
  const context = createLocalMeetingContext(7);
  mockIdentity = { user: { id: 'b' }, sessionCookie: 'other' };
  mockAccountChanged();
  mockIdentity = { user: { id: 'a' }, sessionCookie: 'cookie' };
  mockAccountChanged();
  expect(context.ownsSavedNote()).toBe(false);
  context.dispose();
  const second = createLocalMeetingContext(7);
  mockNote.isPrivate = 0;
  expect(second.ownsSavedNote()).toBe(false);
  mockNote.isPrivate = 1;
  mockNote.deletedAt = 'deleted';
  expect(second.ownsSavedNote()).toBe(false);
  second.dispose();
});
