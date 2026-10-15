/**
 * On-Device cleanup runs through the real retry policy, reasoning routing and
 * Apple Intelligence wrapper; only the native module is faked. A slow or failed
 * run must hand back the raw transcript after one attempt, since a retry would
 * meet the same refusal or time out again.
 */
import { CLEANUP_TIMEOUT_MS, cleanupTranscript } from '@/lib/cleanupTranscript';

interface MockNativeAppleLLM {
  getAvailability: jest.Mock;
  countTokens: jest.Mock;
  generateText: jest.Mock;
  cancelGeneration: jest.Mock;
}

jest.mock('expo', () => {
  const native: MockNativeAppleLLM = {
    getAvailability: jest.fn(),
    countTokens: jest.fn(),
    generateText: jest.fn(),
    cancelGeneration: jest.fn(),
  };
  return { requireNativeModule: (): MockNativeAppleLLM => native, mockNative: native };
});
// The Cloud client imports expo/fetch, which needs the real expo package; an
// On-Device cleanup never reaches it.
jest.mock('@/lib/apiClient', () => ({ api: { post: jest.fn() } }));
// accountAccess pulls in the router for its sign-in alert; stub it here.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/store/useSnippetsStore', () => ({
  useSnippetsStore: { getState: () => ({ isLoaded: true, entries: [] }) },
}));
jest.mock('@/store/useDictionaryStore', () => ({
  useDictionaryStore: { getState: () => ({ isLoaded: true, entries: [] }) },
}));
jest.mock('@/store/useCustomPromptsStore', () => ({
  getActiveCustomCleanupPrompt: () => undefined,
}));
jest.mock('@/store/useConfigStore', () => ({
  useConfigStore: {
    getState: () => ({ config: { cleanupEnabled: true, defaultMode: 'private' } }),
  },
}));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: { getState: () => ({ activeMode: 'private' }) },
}));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u', isAnonymous: false } }) },
}));

const { mockNative } = jest.requireMock<{ mockNative: MockNativeAppleLLM }>('expo');
const onDeviceRoute = { mode: 'local', scope: 'cleanup' } as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockNative.getAvailability.mockResolvedValue({
    status: 'available',
    contextSize: 4096,
    tokenCounting: true,
  });
  mockNative.countTokens.mockResolvedValue(10);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('pastes the raw transcript at the timeout and stops the model run', async () => {
  mockNative.generateText.mockReturnValue(new Promise(() => undefined));
  const onSkipped = jest.fn();
  const result = cleanupTranscript('um hello there', { inferenceRoute: onDeviceRoute, onSkipped });

  await jest.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS);

  await expect(result).resolves.toBe('um hello there');
  expect(onSkipped).toHaveBeenCalledWith('Cleanup failed. Your raw transcript is saved.');
  const { requestId } = mockNative.generateText.mock.calls[0][0] as { requestId: string };
  expect(mockNative.cancelGeneration).toHaveBeenCalledWith(requestId);
  await jest.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS);
  expect(mockNative.generateText).toHaveBeenCalledTimes(1);
});

it.each(['APPLE_LLM_RATE_LIMITED', 'APPLE_LLM_GUARDRAIL', 'APPLE_LLM_FAILED'])(
  'pastes the raw transcript after one %s attempt',
  async (code) => {
    mockNative.generateText.mockRejectedValue(Object.assign(new Error('refused'), { code }));
    const result = cleanupTranscript('um hello there', { inferenceRoute: onDeviceRoute });

    await jest.advanceTimersByTimeAsync(0);

    await expect(result).resolves.toBe('um hello there');
    await jest.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS);
    expect(mockNative.generateText).toHaveBeenCalledTimes(1);
  },
);

it('returns the cleaned text when the model answers in time', async () => {
  mockNative.generateText.mockResolvedValue({
    text: 'Hello there.',
    model: 'apple-foundation-models',
  });
  await expect(
    cleanupTranscript('um hello there', { inferenceRoute: onDeviceRoute }),
  ).resolves.toBe('Hello there.');
});
