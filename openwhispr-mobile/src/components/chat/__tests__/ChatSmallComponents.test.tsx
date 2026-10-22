import { fireEvent, render } from '@testing-library/react-native';
import type { ChatSuggestion } from '@/lib/chat/chatSuggestions';
import { ChatConversationRow } from '../ChatConversationRow';
import { ChatErrorRow } from '../ChatErrorRow';
import { ChatSuggestionCards } from '../ChatSuggestionCards';
import { ChatTranscribingBubble } from '../ChatTranscribingBubble';
import { ChatUserBubble } from '../ChatUserBubble';
import { ChatVoicePanel } from '../ChatVoicePanel';
import { ChatWatermark } from '../ChatWatermark';

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
jest.mock('@/components/features/WaveformVisualizer', () => ({ RecordingBars: () => null }));

describe('chat components', () => {
  it('ChatErrorRow wires Retry and Edit question', () => {
    const onRetry = jest.fn();
    const onEdit = jest.fn();
    const { getByText, getByLabelText } = render(
      <ChatErrorRow message="No connection." disabled={false} onRetry={onRetry} onEdit={onEdit} />,
    );
    expect(getByText('Couldn’t get an answer')).toBeTruthy();
    expect(getByText('No connection. Your question is saved.')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry'));
    fireEvent.press(getByLabelText('Edit question'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('ChatErrorRow ignores presses while disabled', () => {
    const onRetry = jest.fn();
    const onEdit = jest.fn();
    const { getByLabelText } = render(
      <ChatErrorRow message="No connection." disabled onRetry={onRetry} onEdit={onEdit} />,
    );
    expect(getByLabelText('Retry').props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(getByLabelText('Retry'));
    fireEvent.press(getByLabelText('Edit question'));
    expect(onRetry).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('ChatTranscribingBubble shows the elapsed audio time', () => {
    const { getByText } = render(<ChatTranscribingBubble elapsedSeconds={83} />);
    expect(getByText('Transcribing 1:23 of audio')).toBeTruthy();
  });

  it('ChatVoicePanel wires its three buttons and shows the timer', () => {
    const onCancel = jest.fn();
    const onSwitchToTyping = jest.fn();
    const onSend = jest.fn();
    const { getByText, getByLabelText } = render(
      <ChatVoicePanel
        elapsedSeconds={7}
        audioRecorder={null}
        onCancel={onCancel}
        onSwitchToTyping={onSwitchToTyping}
        onSend={onSend}
      />,
    );
    expect(getByText('Listening')).toBeTruthy();
    expect(getByText('0:07')).toBeTruthy();
    fireEvent.press(getByLabelText('Cancel'));
    fireEvent.press(getByLabelText('Switch to typing'));
    fireEvent.press(getByLabelText('Send'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSwitchToTyping).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('ChatSuggestionCards passes the pressed suggestion and honours disabled', () => {
    const suggestion: ChatSuggestion = {
      kind: 'actions',
      meta: 'This week',
      label: 'List my open action items',
      prompt: 'List them',
    };
    const onPress = jest.fn();
    const enabled = render(
      <ChatSuggestionCards suggestions={[suggestion]} onPress={onPress} disabled={false} />,
    );
    expect(enabled.getByText('This week')).toBeTruthy();
    fireEvent.press(enabled.getByText('List my open action items'));
    expect(onPress).toHaveBeenCalledWith(suggestion);

    onPress.mockClear();
    const disabled = render(
      <ChatSuggestionCards suggestions={[suggestion]} onPress={onPress} disabled />,
    );
    fireEvent.press(disabled.getByText('List my open action items'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ChatConversationRow shows title, preview and opens on press', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <ChatConversationRow
        conversation={{
          id: 'c1',
          title: 'Pricing',
          preview: 'You agreed on $40',
          createdAt: 0,
          updatedAt: Date.now(),
        }}
        onPress={onPress}
      />,
    );
    expect(getByText('You agreed on $40')).toBeTruthy();
    fireEvent.press(getByText('Pricing'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the user bubble and the watermark', () => {
    const { getByText } = render(
      <>
        <ChatWatermark />
        <ChatUserBubble text="What did we decide?" />
      </>,
    );
    expect(getByText('What did we decide?')).toBeTruthy();
  });
});
