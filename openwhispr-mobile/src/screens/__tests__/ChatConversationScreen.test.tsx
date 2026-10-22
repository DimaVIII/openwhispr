import { act, fireEvent, render } from '@testing-library/react-native';
import { useChatStore } from '@/store/useChatStore';
import type { ChatMessage } from '@/lib/chat/types';
import { ChatConversationScreen } from '../ChatConversationScreen';

let mockParams: Record<string, string> = { id: 'c1' };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/data', () => ({
  chatRepository: {
    listConversations: jest.fn(() => []),
    getConversation: jest.fn(() => null),
    getMessages: jest.fn(() => []),
  },
}));
jest.mock('@/lib/chat/runChatTurn', () => ({ runChatTurn: jest.fn() }));
jest.mock('@/hooks/useChatSendGate', () => ({
  useChatSendGate: () => ({
    chatEnabled: true,
    gate: (run: (allowCloudFallback: boolean) => void) => run(false),
  }),
}));
jest.mock('@/hooks/useChatVoiceInput', () => ({
  useChatVoiceInput: () => ({
    state: 'idle',
    elapsedSeconds: 3,
    audioRecorder: {},
    start: jest.fn(async () => true),
    finish: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined),
  }),
}));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: (selector: (state: { activeMode: string }) => unknown) =>
    selector({ activeMode: 'cloud' }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  Easing: { inOut: jest.fn(), ease: jest.fn(), linear: jest.fn() },
  cancelAnimation: jest.fn(),
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (initial: number) => ({ value: initial }),
  withRepeat: jest.fn(),
  withTiming: jest.fn(),
}));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/ui/OpenWhisprMark', () => ({ OpenWhisprMark: () => null }));
jest.mock('@/components/ui/GlassBackButton', () => ({ GlassBackButton: () => null }));
jest.mock('@/lib/utils', () => ({ safeHaptics: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const question: ChatMessage = {
  id: 'm1',
  conversationId: 'c1',
  role: 'user',
  text: 'What did we decide?',
  steps: [],
  sources: [],
  createdAt: 1,
};

const mockCancel = jest.fn();
const mockRetry = jest.fn(async () => undefined);
const mockEditFailedQuestion = jest.fn(() => 'What did we decide?');

beforeEach(() => {
  mockParams = { id: 'c1' };
  jest.clearAllMocks();
  useChatStore.setState({
    conversations: [
      { id: 'c1', title: 'Pricing decisions', preview: '', createdAt: 1, updatedAt: 1 },
    ],
    activeConversationId: 'c1',
    messages: [question],
    pending: null,
    failure: null,
    cancel: mockCancel,
    retry: mockRetry,
    editFailedQuestion: mockEditFailedQuestion,
  });
});

describe('ChatConversationScreen', () => {
  it('shows the transcribing bubble for this chat', () => {
    useChatStore.setState({
      pending: { conversationId: 'c1', phase: 'transcribing', steps: [], startedAt: Date.now() },
    });
    const screen = render(<ChatConversationScreen />);
    expect(screen.getByText('Transcribing 0:03 of audio')).toBeTruthy();

    act(() => {
      useChatStore.setState({
        pending: { conversationId: 'c2', phase: 'transcribing', steps: [], startedAt: Date.now() },
      });
    });
    expect(screen.queryByText('Transcribing 0:03 of audio')).toBeNull();
  });

  it('shows the working line with a Stop button', () => {
    useChatStore.setState({
      pending: {
        conversationId: 'c1',
        phase: 'working',
        steps: [{ id: 'search', status: 'active', label: 'Searching your notes' }],
        startedAt: Date.now(),
      },
    });
    const screen = render(<ChatConversationScreen />);
    expect(screen.getByText('Searching your notes')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Stop'));
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('shows Retry after a failure', () => {
    useChatStore.setState({
      failure: {
        conversationId: 'c1',
        messageId: 'm1',
        question: question.text,
        message: 'Check your connection and try again.',
      },
    });
    const screen = render(<ChatConversationScreen />);
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Retry'));
    expect(mockRetry).toHaveBeenCalledWith({ allowCloudFallback: false });
  });

  it('fills the composer from Edit question', () => {
    useChatStore.setState({
      failure: {
        conversationId: 'c1',
        messageId: 'm1',
        question: question.text,
        message: 'Check your connection and try again.',
      },
    });
    const screen = render(<ChatConversationScreen />);

    fireEvent.press(screen.getByLabelText('Edit question'));
    expect(mockEditFailedQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Reply').props.value).toBe('What did we decide?');
  });

  it('hides a failure from another chat', () => {
    useChatStore.setState({
      failure: { conversationId: 'c2', messageId: 'm9', question: 'Other', message: 'Offline' },
    });
    const screen = render(<ChatConversationScreen />);
    expect(screen.queryByLabelText('Retry')).toBeNull();
  });
});
