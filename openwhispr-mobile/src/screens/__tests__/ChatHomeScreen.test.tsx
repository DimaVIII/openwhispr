import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { GoogleCalendarEvent, Note } from '@/data';
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
let mockChatEnabled = true;
let mockCandidateNotes: Partial<Note>[] = [];
let mockEvents: Partial<GoogleCalendarEvent>[] = [];

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@/data', () => ({
  chatRepository: { listConversations: () => [] },
  notesRepository: {
    getChatCandidateNotes: () => ({ notes: mockCandidateNotes, total: mockCandidateNotes.length }),
  },
  calendarRepository: {},
}));
jest.mock('@/lib/chat/runChatTurn', () => ({ runChatTurn: jest.fn() }));
jest.mock('@/lib/calendar/meetingSuggestions', () => ({
  getMeetingCalendarEventSuggestions: () => mockEvents,
}));
jest.mock('@/store/useGoogleCalendarStore', () => ({
  useGoogleCalendarStore: { getState: () => ({ accounts: [], load: async () => undefined }) },
}));
jest.mock('@/hooks/useChatSendGate', () => ({
  useChatSendGate: () => ({
    chatEnabled: mockChatEnabled,
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
  mockChatEnabled = true;
  mockCandidateNotes = [];
  mockEvents = [];
  jest.clearAllMocks();
  useChatStore.setState({ conversations: [], pending: null, failures: {}, send: mockSend });
});

describe('ChatHomeScreen', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends a suggestion and opens its chat', async () => {
    const screen = await renderHome();
    fireEvent.press(screen.getByText(ACTION_ITEMS));
    expect(mockSend).toHaveBeenCalledWith("List my open action items from this week's notes.", {
      conversationId: null,
      allowCloudFallback: false,
    });
    expect(router.push).toHaveBeenCalledWith('/(tabs)/(chat)/c9');
  });

  it('offers no New chat while Chat is off', async () => {
    mockChatEnabled = false;
    const screen = await renderHome();

    expect(screen.getByText('Chat is turned off')).toBeTruthy();
    expect(screen.queryByLabelText('New chat')).toBeNull();
    expect(screen.getByLabelText('All chats')).toBeTruthy();

    fireEvent.press(screen.getByText('Open Chat settings'));
    expect(router.push).toHaveBeenCalledWith('/(account)/ai-workflow?scope=noteChat');
  });

  it('suggests a later meeting when the next one has been running a while', async () => {
    const now = new Date();
    const at = (hours: number, minutes = 0): string =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes).toISOString();
    jest.useFakeTimers({ now: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9) });
    mockEvents = [
      { id: 1, summary: 'Standup', startAt: at(8, 30), endAt: at(9, 30) },
      { id: 2, summary: 'Design review', startAt: at(14), endAt: at(15) },
    ];
    const screen = await renderHome();

    expect(screen.getByText(/^Design review · /)).toBeTruthy();
    expect(screen.queryByText(/^Standup · /)).toBeNull();
  });

  it('skips a meeting note that is still transcribing or has nothing in it', async () => {
    const updatedAt = new Date().toISOString();
    mockCandidateNotes = [
      {
        id: 1,
        title: 'Recording now',
        noteType: 'meeting',
        transcriptionStatus: 'recording',
        content: 'typed',
        updatedAt,
      },
      {
        id: 2,
        title: 'Failed empty',
        noteType: 'meeting',
        transcriptionStatus: 'failed',
        content: '',
        updatedAt,
      },
      {
        id: 3,
        title: 'Weekly sync',
        noteType: 'meeting',
        transcriptionStatus: 'done',
        content: '',
        updatedAt,
      },
    ];
    const screen = await renderHome();

    expect(screen.getByText('Weekly sync · Today')).toBeTruthy();
    expect(screen.queryByText(/Recording now|Failed empty/)).toBeNull();
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

  it('locks the composer with no Stop while a chat is working, and links to it', async () => {
    const screen = await renderHome();
    act(() => {
      useChatStore.setState({
        conversations: [
          { id: 'c4', title: 'Pricing decisions', preview: '', createdAt: 1, updatedAt: 1 },
        ],
        pending: { conversationId: 'c4', phase: 'working', steps: [], startedAt: Date.now() },
      });
    });

    expect(screen.queryByLabelText('Stop')).toBeNull();
    expect(screen.getByPlaceholderText('Ask anything').props.editable).toBe(false);
    fireEvent.press(screen.getByLabelText('Working on “Pricing decisions”…'));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/(chat)/c4');
  });

  it('names a new chat’s question without a link', async () => {
    const screen = await renderHome();
    act(() => {
      useChatStore.setState({
        pending: { conversationId: null, phase: 'transcribing', steps: [], startedAt: Date.now() },
      });
    });

    expect(screen.getByText('Working on your question…')).toBeTruthy();
    expect(screen.queryByLabelText('Working on your question…')).toBeNull();
    expect(screen.queryByLabelText('Stop')).toBeNull();
    expect(screen.queryByText('Transcribing…')).toBeNull();
  });

  it('keeps Stop for its own spoken question while it transcribes', async () => {
    mockVoice.state = 'transcribing';
    const screen = await renderHome();
    act(() => {
      useChatStore.setState({
        pending: { conversationId: null, phase: 'transcribing', steps: [], startedAt: Date.now() },
      });
    });

    expect(screen.getByText('Transcribing…')).toBeTruthy();
    expect(screen.queryByText('Working on your question…')).toBeNull();
    fireEvent.press(screen.getByLabelText('Stop'));
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
