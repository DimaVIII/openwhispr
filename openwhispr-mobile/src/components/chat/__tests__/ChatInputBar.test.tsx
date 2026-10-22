import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { ChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { safeHaptics } from '@/lib/utils';
import { ChatInputBar, type StartVoice } from '../ChatInputBar';

jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/features/WaveformVisualizer', () => ({ RecordingBars: () => null }));
jest.mock('@/hooks/useAudioWaveform', () => ({
  useAudioWaveform: () => ({ waveformData: [], currentAmplitude: 0 }),
}));
jest.mock('@/lib/utils', () => ({ safeHaptics: jest.fn() }));

const makeVoice = (overrides: Partial<ChatVoiceInput> = {}): ChatVoiceInput => ({
  state: 'idle',
  elapsedSeconds: 0,
  audioRecorder: {} as ChatVoiceInput['audioRecorder'],
  start: jest.fn(async () => true),
  finish: jest.fn(async () => undefined),
  cancel: jest.fn(async () => undefined),
  ...overrides,
});

type Props = React.ComponentProps<typeof ChatInputBar>;

const baseProps = (voice: ChatVoiceInput, overrides: Partial<Props> = {}): Props => ({
  voice,
  value: '',
  onChangeText: jest.fn(),
  placeholder: 'Reply',
  busy: false,
  canStop: true,
  disabled: false,
  onSend: jest.fn(),
  onMicPress: (startVoice: StartVoice) => startVoice(false),
  onCancelTurn: jest.fn(),
  restingBottomPadding: 14,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('ChatInputBar', () => {
  it('shows the voice panel in place of the composer while listening', () => {
    const voice = makeVoice({ state: 'listening' });
    const screen = render(<ChatInputBar {...baseProps(voice)} />);
    expect(screen.getByText('Listening')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Reply')).toBeNull();

    fireEvent.press(screen.getByLabelText('Send'));
    fireEvent.press(screen.getByLabelText('Cancel'));
    expect(voice.finish).toHaveBeenCalledTimes(1);
    expect(voice.cancel).toHaveBeenCalledTimes(1);
  });

  it('stops a transcribing question, or else the working turn', () => {
    const transcribing = makeVoice({ state: 'transcribing' });
    const first = render(<ChatInputBar {...baseProps(transcribing, { busy: true })} />);
    fireEvent.press(first.getByLabelText('Stop'));
    expect(transcribing.cancel).toHaveBeenCalledTimes(1);

    const idle = makeVoice();
    const onCancelTurn = jest.fn();
    const second = render(<ChatInputBar {...baseProps(idle, { busy: true, onCancelTurn })} />);
    fireEvent.press(second.getByLabelText('Stop'));
    expect(onCancelTurn).toHaveBeenCalledTimes(1);
    expect(idle.cancel).not.toHaveBeenCalled();
  });

  it('offers no Stop for a turn the screen does not own, and shows its notice', () => {
    const onCancelTurn = jest.fn();
    const screen = render(
      <ChatInputBar
        {...baseProps(makeVoice(), {
          busy: true,
          canStop: false,
          onCancelTurn,
          notice: <Text>Working on “Pricing”…</Text>,
        })}
      />,
    );
    expect(screen.queryByLabelText('Stop')).toBeNull();
    expect(screen.getByText('Working on “Pricing”…')).toBeTruthy();
    expect(screen.getByPlaceholderText('Reply').props.editable).toBe(false);
  });

  it('starts voice through onMicPress, with a light haptic when it is refused', async () => {
    const voice = makeVoice({ start: jest.fn(async () => false) });
    const onMicPress = jest.fn((startVoice: StartVoice) => startVoice(true));
    const screen = render(<ChatInputBar {...baseProps(voice, { onMicPress })} />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Speak your question'));
    });
    expect(onMicPress).toHaveBeenCalledTimes(1);
    expect(voice.start).toHaveBeenCalledWith(true);
    expect(safeHaptics).toHaveBeenCalledWith('light');
  });

  it('focuses the composer after Switch to typing', () => {
    const listening = makeVoice({ state: 'listening' });
    const screen = render(<ChatInputBar {...baseProps(listening)} />);
    fireEvent.press(screen.getByLabelText('Switch to typing'));
    expect(listening.cancel).toHaveBeenCalledTimes(1);

    screen.rerender(<ChatInputBar {...baseProps(makeVoice())} />);
    expect(screen.getByPlaceholderText('Reply').props.autoFocus).toBe(true);
  });
});
