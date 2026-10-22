import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useChatStore } from '@/store/useChatStore';
import { ChatHomeScreen } from '../ChatHomeScreen';

const mockVoice = {
  state: 'idle' as 'idle' | 'listening' | 'transcribing',
  elapsedSeconds: 0,
  audioRecorder: {},
  start: jest.fn(async () => true),
  finish: jest.fn(async () => undefined),
  cancel: jest.fn(async () => undefined),
};
let mockOnSent: ((conversationId: string) => void) | undefined;

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@/data', () => ({
  chatRepository: { listConversations: () => [] },
  notesRepository: { getChatCandidateNotes: () => [] },
  calendarRepository: {},
}));
jest.mock('@/lib/chat/runChatTurn', () => ({ runChatTurn: jest.fn() }));
jest.mock('@/lib/calendar/meetingSuggestions', () => ({
  getMeetingCalendarEventSuggestions: () => [],
}));
jest.mock('@/store/useGoogleCalendarStore', () => ({
  useGoogleCalendarStore: { getState: () => ({ accounts: [], load: async () => undefined }) },
}));
jest.mock('@/hooks/useChatSendGate', () => ({
  useChatSendGate: () => ({
    chatEnabled: true,
    gate: (run: (allowCloudFallback: boolean) => void) => run(false),
  }),
}));
jest.mock('@/hooks/useChatVoiceInput', () => ({
  useChatVoiceInput: (options: { onSent?: (conversationId: string) => void }) => {
    mockOnSent = options.onSent;
    return mockVoice;
  },
}));
jest.mock('@/hooks/useAudioWaveform', () => ({
  useAudioWaveform: () => ({ waveformData: [], currentAmplitude: 0 }),
}));
jest.mock('@/components/features/WaveformVisualizer', () => ({ RecordingBars: () => null }));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: (selector: (state: { activeMode: string }) => unknown) =>
    selector({ activeMode: 'cloud' }),
}));
jest.mock('@/components/ui/GlassIconButton', () => {
  const { Pressable } = require('react-native');
  return {
    GLASS_CAPSULE_SIZE: 36,
    GlassIconButton: ({
      accessibilityLabel,
      onPress,
    }: {
      accessibilityLabel: string;
      onPress: () => void;
    }) => <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} />,
  };
});
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/lib/utils', () => ({ safeHaptics: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockSend = jest.fn(() => ({ conversationId: 'c9', done: Promise.resolve() }));
const ACTION_ITEMS = 'List my open action items';

const renderHome = async (): Promise<ReturnType<typeof render>> => {
  const screen = render(<ChatHomeScreen />);
  // Let the calendar load settle, which refreshes the suggestions.
  await act(async () => undefined);
  return screen;
};

beforeEach(() => {
  mockVoice.state = 'idle';
  mockOnSent = undefined;
  jest.clearAllMocks();
  useChatStore.setState({ conversations: [], pending: null, failure: null, send: mockSend });
});

describe('ChatHomeScreen', () => {
  it('sends a suggestion and opens its chat', async () => {
    const screen = await renderHome();
    fireEvent.press(screen.getByText(ACTION_ITEMS));
    expect(mockSend).toHaveBeenCalledWith("List my open action items from this week's notes.", {
      conversationId: null,
      allowCloudFallback: false,
    });
    expect(router.push).toHaveBeenCalledWith('/(tabs)/(chat)/c9');
  });

  it('ignores a suggestion tap while listening', async () => {
    mockVoice.state = 'listening';
    const screen = await renderHome();
    fireEvent.press(screen.getByText(ACTION_ITEMS));
    fireEvent.press(screen.getByLabelText('New chat'));
    fireEvent.press(screen.getByLabelText('All chats'));
    expect(mockSend).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('cancels listening when the screen loses focus', async () => {
    mockVoice.state = 'listening';
    const screen = await renderHome();
    expect(mockVoice.cancel).not.toHaveBeenCalled();

    screen.unmount();
    expect(mockVoice.cancel).toHaveBeenCalledTimes(1);
  });

  it('opens a spoken question’s chat only while Home has focus', async () => {
    const screen = await renderHome();
    mockOnSent?.('c1');
    expect(router.push).toHaveBeenCalledWith('/(tabs)/(chat)/c1');

    screen.unmount();
    mockOnSent?.('c2');
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
