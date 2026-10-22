import { act, renderHook } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useAudioRecording, type UseAudioRecordingOptions } from '../useAudioRecording';
import { transcribeAndCleanup } from '@/lib/transcribeAndCleanup';
import { analyzeSpeechActivity } from '@/lib/speechActivity';
import { deleteManagedTranscriptAudio } from '@/lib/transcriptAudio';
import { isLocalModelMissingError } from '@/services/transcription/TranscriptionService';

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
  deleteAsync: jest.fn(async () => undefined),
}));

// permissions.ts re-exports the alert helper, which reaches nativewind through
// the UI layer — untransformable here and irrelevant to the branch under test.
jest.mock('@/components/ui/PermissionAlert', () => ({ showPermissionAlert: jest.fn() }));

const mockAddTranscript = jest.fn(async () => undefined);
const mockAddFailedTranscript = jest.fn(async () => undefined);
jest.mock('@/store/useTranscriptStore', () => ({
  createTranscriptId: jest.fn(() => 'test-id'),
  useTranscriptStore: (selector: (state: unknown) => unknown) =>
    selector({ addTranscript: mockAddTranscript, addFailedTranscript: mockAddFailedTranscript }),
}));

jest.mock('@/lib/inferenceRouting', () => ({
  snapshotTranscriptionJob: () => ({ provider: 'local' }),
  snapshotTextInference: () => ({}),
}));

jest.mock('@/lib/transcribeAndCleanup', () => ({ transcribeAndCleanup: jest.fn() }));
jest.mock('@/services/transcription/TranscriptionService', () => ({
  isLocalModelMissingError: jest.fn(() => false),
}));
jest.mock('@/lib/speechActivity', () => ({
  analyzeSpeechActivity: jest.fn(async () => null),
  createNoSpeechError: jest.fn(() => new Error('No speech detected')),
}));
jest.mock('@/lib/transcriptAudio', () => ({
  retainTranscriptAudio: jest.fn(async () => 'file:///docs/transcript-audio/test-id.wav'),
  deleteManagedTranscriptAudio: jest.fn(async () => undefined),
}));
jest.mock('@/lib/transcriptionLanguage', () => ({
  getPreferredTranscriptionLanguage: jest.fn(() => 'en'),
}));

// jest hoists mock factories above the module body, so anything they close over
// has to be mock-prefixed to survive the hoist.
const mockRecorder = {
  isRecording: false,
  uri: 'file:///tmp/rec.wav',
  prepareToRecordAsync: jest.fn(async () => undefined),
  record: jest.fn(),
  stop: jest.fn(async () => undefined),
};

const mockAudioModule = {
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestNotificationPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
};

jest.mock('expo-audio', () => ({ useAudioRecorder: () => mockRecorder }));
jest.mock('@/utils/expoAudio', () => ({
  getExpoAudioModule: () => ({ AudioModule: mockAudioModule }),
  isExpoAudioAvailable: () => true,
  getDefaultRecorderOptions: () => ({}),
}));

const RETAINED_URI = 'file:///docs/transcript-audio/test-id.wav';
const mockTranscribe = jest.mocked(transcribeAndCleanup);

const transcribed = (text: string): Awaited<ReturnType<typeof transcribeAndCleanup>> =>
  ({
    text,
    originalText: text,
    transcription: { duration: 1, provider: 'cloud' },
  }) as Awaited<ReturnType<typeof transcribeAndCleanup>>;

async function recordAndStop(options: UseAudioRecordingOptions): Promise<{ stopError: unknown }> {
  const { result } = renderHook(() => useAudioRecording(options));
  await act(async () => {
    await result.current.startRecording();
  });
  mockRecorder.isRecording = true;
  let stopError: unknown;
  await act(async () => {
    await result.current.stopRecording().catch((error: unknown) => {
      stopError = error;
    });
  });
  return { stopError };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTranscribe.mockReset();
  jest.mocked(isLocalModelMissingError).mockReturnValue(false);
  mockRecorder.isRecording = false;
});

it('does not write transcript history when saveToHistory is false', async () => {
  mockTranscribe.mockResolvedValue(transcribed('What is on my calendar?'));
  const onComplete = jest.fn();
  const onError = jest.fn();

  await recordAndStop({ saveToHistory: false, onComplete, onError });

  expect(mockAddTranscript).not.toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledWith('What is on my calendar?');
  expect(onError).not.toHaveBeenCalled();
  expect(deleteManagedTranscriptAudio).toHaveBeenCalledWith(RETAINED_URI);
});

it('does not keep a failed recording when saveToHistory is false', async () => {
  mockTranscribe.mockRejectedValue(new Error('Network down'));
  const onError = jest.fn();

  const { stopError } = await recordAndStop({ saveToHistory: false, onError });

  expect(stopError).toEqual(expect.objectContaining({ message: 'Network down' }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network down' }));
  expect(mockAddFailedTranscript).not.toHaveBeenCalled();
  expect(deleteManagedTranscriptAudio).toHaveBeenCalledWith(RETAINED_URI);
});

it('leaves no recording behind when no speech was heard and saveToHistory is false', async () => {
  jest
    .mocked(analyzeSpeechActivity)
    .mockResolvedValueOnce({ noSpeechLikely: true } as Awaited<
      ReturnType<typeof analyzeSpeechActivity>
    >);
  const onError = jest.fn();

  await recordAndStop({ saveToHistory: false, onError });

  expect(mockTranscribe).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///tmp/rec.wav', { idempotent: true });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'No speech detected' }));
});

it('keeps the recording for a cloud retry without a history row, then removes it', async () => {
  const missing = new Error('Local model missing');
  mockTranscribe.mockRejectedValueOnce(missing).mockResolvedValueOnce(transcribed('Retried.'));
  jest.mocked(isLocalModelMissingError).mockImplementation((error) => error === missing);
  let retryWithCloud: (() => void) | undefined;
  const onComplete = jest.fn();

  await recordAndStop({
    saveToHistory: false,
    onComplete,
    onLocalModelMissing: (retry) => {
      retryWithCloud = retry;
    },
  });

  expect(mockAddFailedTranscript).not.toHaveBeenCalled();
  expect(deleteManagedTranscriptAudio).not.toHaveBeenCalled();

  await act(async () => {
    retryWithCloud?.();
  });

  expect(onComplete).toHaveBeenCalledWith('Retried.');
  expect(mockAddTranscript).not.toHaveBeenCalled();
  expect(deleteManagedTranscriptAudio).toHaveBeenCalledWith(RETAINED_URI);
});

it('still writes history by default', async () => {
  mockTranscribe.mockResolvedValue(transcribed('Saved.'));

  await recordAndStop({});

  expect(mockAddTranscript).toHaveBeenCalledWith(expect.objectContaining({ text: 'Saved.' }));
  expect(deleteManagedTranscriptAudio).not.toHaveBeenCalled();
});
