import { LocalReasoningError } from '@/lib/localReasoning';
import { toChatErrorMessage } from '../chatErrorMessage';

const CONNECTION = 'Check your connection and try again.';

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

describe('toChatErrorMessage', () => {
  it('reads a timeout or a failed fetch as a connection problem', () => {
    expect(toChatErrorMessage(namedError('AbortError', 'The operation timed out.'))).toBe(
      CONNECTION,
    );
    expect(toChatErrorMessage(namedError('TimeoutError', 'signal timed out'))).toBe(CONNECTION);
    expect(toChatErrorMessage(new TypeError('Network request failed'))).toBe(CONNECTION);
  });

  it('says when on-device AI is unavailable', () => {
    expect(
      toChatErrorMessage(
        new LocalReasoningError('LOCAL_REASONING_UNAVAILABLE', 'Apple Intelligence is off.'),
      ),
    ).toBe('On-device AI isn’t available right now.');
  });

  it('suggests a shorter question when on-device AI runs out of context', () => {
    expect(
      toChatErrorMessage(new LocalReasoningError('LOCAL_CONTEXT_LIMIT', 'Context window full.')),
    ).toBe(
      'This question needs more context than on-device AI can handle. Try a shorter question or start a new chat.',
    );
  });

  it('keeps an organization policy message', () => {
    const message = "Your organization's policy doesn't allow OpenWhispr cloud AI.";
    expect(toChatErrorMessage(new Error(message))).toBe(message);
  });

  it('hides raw provider text and anything that is not an error', () => {
    expect(toChatErrorMessage(new Error('HTTP 502: upstream connect error'))).toBe(CONNECTION);
    expect(toChatErrorMessage(new Error(''))).toBe(CONNECTION);
    expect(toChatErrorMessage('boom')).toBe(CONNECTION);
  });
});
