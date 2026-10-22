import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { UseAudioRecordingOptions } from '../useAudioRecording';

jest.mock('@/data', () => ({ chatRepository: {} }));
jest.mock('@/lib/chat/runChatTurn', () => ({ runChatTurn: jest.fn() }));
jest.mock('@/components/ui/PermissionAlert', () => ({ showPermissionAlert: jest.fn() }));
jest.mock('@/lib/privateMode', () => ({ promptLocalModelFallback: jest.fn() }));
const mockHandleUsageLimitReached = jest.fn(async () => undefined);
jest.mock('@/hooks/useUsageLimitRecovery', () => ({
  useUsageLimitRecovery: () => ({
    handleUsageLimitReached: mockHandleUsageLimitReached,
    isRecoveringUsageLimit: false,
  }),
}));

// The recorder is driven by hand: each test decides what stopping it produces.
let mockRecordingOptions: UseAudioRecordingOptions = {};
let mockIsRecording = false;
let mockStopBehavior: () => Promise<void> = async () => undefined;
const mockStartRecording = jest.fn(async () => {
  mockIsRecording = true;
});
const mockCancelRecording = jest.fn(async () => {
  mockIsRecording = false;
});
const mockStopRecording = jest.fn(async () => {
  mockIsRecording = false;
  await mockStopBehavior();
});
jest.mock('@/hooks/useAudioRecording', () => ({
  useAudioRecording: (options: UseAudioRecordingOptions) => {
    mockRecordingOptions = options;
    return {
      isRecording: mockIsRecording,
      isProcessing: false,
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      cancelRecording: mockCancelRecording,
      audioRecorder: {},
    };
  },
}));

import { useChatStore } from '@/store/useChatStore';
import { useChatVoiceInput } from '../useChatVoiceInput';

const mockSend = jest.fn();

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const renderVoiceInput = (conversationId: string | null, onSent?: (id: string) => void) =>
  renderHook(() => useChatVoiceInput({ conversationId, onSent }));

beforeEach(() => {
  jest.clearAllMocks();
  mockIsRecording = false;
  mockStopBehavior = async () => undefined;
  useChatStore.getState().reset();
  mockSend.mockReturnValue({ conversationId: 'conv-1', done: Promise.resolve() });
  useChatStore.setState({ send: mockSend });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

it('does not save the spoken question to transcript history', () => {
  renderVoiceInput('conv-1');
  expect(mockRecordingOptions.saveToHistory).toBe(false);
});

it('sends the transcript as a chat question', async () => {
  const onSent = jest.fn();
  mockStopBehavior = async () => {
    expect(useChatStore.getState().pending).toEqual(
      expect.objectContaining({ phase: 'transcribing', conversationId: 'conv-1' }),
    );
    mockRecordingOptions.onComplete?.('When is my next meeting?');
  };
  const { result, rerender } = renderVoiceInput('conv-1', onSent);

  await act(async () => {
    await result.current.start(true);
  });
  rerender({});
  expect(result.current.state).toBe('listening');
  await act(async () => {
    await result.current.finish();
  });

  expect(mockSend).toHaveBeenCalledWith('When is my next meeting?', {
    conversationId: 'conv-1',
    allowCloudFallback: true,
  });
  expect(onSent).toHaveBeenCalledWith('conv-1');
  expect(useChatStore.getState().pending).toBeNull();
  rerender({});
  expect(result.current.state).toBe('idle');
});

it('ignores a transcript that arrives after cancel', async () => {
  const transcription = deferred();
  mockStopBehavior = async () => {
    await transcription.promise;
    mockRecordingOptions.onComplete?.('Too late');
  };
  const { result, rerender } = renderVoiceInput(null);

  await act(async () => {
    await result.current.start(false);
  });
  rerender({});
  let finishing: Promise<void> = Promise.resolve();
  await act(async () => {
    finishing = result.current.finish();
  });
  expect(result.current.state).toBe('transcribing');

  await act(async () => {
    await result.current.cancel();
  });
  expect(useChatStore.getState().pending).toBeNull();
  await act(async () => {
    transcription.resolve();
    await finishing;
  });

  expect(mockSend).not.toHaveBeenCalled();
  expect(useChatStore.getState().pending).toBeNull();
  rerender({});
  expect(result.current.state).toBe('idle');
});

it('sends nothing when no speech was heard', async () => {
  mockStopBehavior = async () => {
    const error = new Error('No speech detected');
    mockRecordingOptions.onError?.(error);
    throw error;
  };
  const { result, rerender } = renderVoiceInput('conv-1');

  await act(async () => {
    await result.current.start(false);
  });
  rerender({});
  await act(async () => {
    await result.current.finish();
  });

  expect(mockSend).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(useChatStore.getState().pending).toBeNull();
});

it('reports other failures and releases the transcribing slot', async () => {
  mockStopBehavior = async () => {
    const error = new Error('Network down');
    mockRecordingOptions.onError?.(error);
    throw error;
  };
  const { result, rerender } = renderVoiceInput('conv-1');

  await act(async () => {
    await result.current.start(false);
  });
  rerender({});
  await act(async () => {
    await result.current.finish();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Couldn’t hear that', 'Network down');
  expect(mockSend).not.toHaveBeenCalled();
  expect(useChatStore.getState().pending).toBeNull();
});

it('drops the transcript when another turn took over the slot', async () => {
  mockStopBehavior = async () => {
    useChatStore.getState().cancel();
    useChatStore.getState().beginTranscribing('conv-1');
    mockRecordingOptions.onComplete?.('Stale question');
  };
  const { result, rerender } = renderVoiceInput('conv-1');

  await act(async () => {
    await result.current.start(false);
  });
  rerender({});
  await act(async () => {
    await result.current.finish();
  });

  expect(mockSend).not.toHaveBeenCalled();
  // The slot belongs to whoever took it over, so it stays theirs.
  expect(useChatStore.getState().pending?.phase).toBe('transcribing');
});

it('cancels the recording when a chat turn is already running', async () => {
  const { result, rerender } = renderVoiceInput('conv-1');
  await act(async () => {
    await result.current.start(false);
  });
  rerender({});
  useChatStore.getState().beginTranscribing('conv-2');

  await act(async () => {
    await result.current.finish();
  });

  expect(mockCancelRecording).toHaveBeenCalled();
  expect(mockStopRecording).not.toHaveBeenCalled();
  expect(useChatStore.getState().pending?.conversationId).toBe('conv-2');
});

it('does not start while a chat turn is running', async () => {
  useChatStore.getState().beginTranscribing('conv-2');
  const { result } = renderVoiceInput('conv-1');

  await act(async () => {
    await result.current.start(false);
  });

  expect(mockStartRecording).not.toHaveBeenCalled();
});

it('stops the recorder when cancelled while listening', async () => {
  const { result, rerender } = renderVoiceInput('conv-1');
  await act(async () => {
    await result.current.start(false);
  });
  rerender({});

  await act(async () => {
    await result.current.cancel();
  });

  expect(mockCancelRecording).toHaveBeenCalled();
  expect(useChatStore.getState().pending).toBeNull();
});

it('releases the slot once usage-limit recovery ends without a retry', async () => {
  mockStopBehavior = async () => {
    await mockRecordingOptions.onUsageLimitReached?.(
      Object.assign(new Error('limit'), { source: 'dictation' }) as never,
      async () => undefined,
    );
  };
  const { result, rerender } = renderVoiceInput('conv-1');
  await act(async () => {
    await result.current.start(false);
  });
  rerender({});
  await act(async () => {
    await result.current.finish();
  });

  expect(mockHandleUsageLimitReached).toHaveBeenCalled();
  expect(useChatStore.getState().pending).toBeNull();
});

it('ticks elapsed seconds while listening', async () => {
  jest.useFakeTimers();
  try {
    const { result, rerender } = renderVoiceInput('conv-1');
    await act(async () => {
      await result.current.start(false);
    });
    rerender({});
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current.elapsedSeconds).toBe(3);
  } finally {
    jest.useRealTimers();
  }
});
