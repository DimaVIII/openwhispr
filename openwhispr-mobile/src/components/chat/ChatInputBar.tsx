import { useRef, useState } from 'react';
import { View } from 'react-native';
import type { ChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { safeHaptics } from '@/lib/utils';
import { ChatComposer } from './ChatComposer';
import { ChatVoicePanel } from './ChatVoicePanel';

const COMPOSER_KEYBOARD_GAP = 10;
// The voice panel's Send and the composer's Stop share a spot, so a double tap on Send would stop
// the question it just sent.
const STOP_AFTER_SEND_GRACE_MS = 500;

export type StartVoice = (allowCloudFallback: boolean) => void;

interface ChatInputBarProps {
  voice: ChatVoiceInput;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  busy: boolean;
  /** Whether the busy turn or transcription is this screen's own, so Stop can end it. */
  canStop: boolean;
  disabled: boolean;
  onSend: () => void;
  /** Runs the screen's checks, then calls `startVoice` to open the mic. */
  onMicPress: (startVoice: StartVoice) => void;
  /** Stops the turn that's working; a transcribing question is stopped here. */
  onCancelTurn: () => void;
  /** Space below the bar while the keyboard is hidden. */
  restingBottomPadding: number;
  /** A line above the composer, e.g. naming the chat that's working. */
  notice?: React.ReactNode;
}

/** The composer, or the voice panel while listening, kept above the keyboard. */
export function ChatInputBar({
  voice,
  value,
  onChangeText,
  placeholder,
  busy,
  canStop,
  disabled,
  onSend,
  onMicPress,
  onCancelTurn,
  restingBottomPadding,
  notice,
}: ChatInputBarProps): React.JSX.Element {
  const keyboardHeight = useKeyboardHeight();
  // The composer unmounts while the voice panel shows, so it takes focus as it mounts again.
  const [focusComposer, setFocusComposer] = useState(false);
  const finishedAtRef = useRef(0);

  const startVoice: StartVoice = (allowCloudFallback) => {
    setFocusComposer(false);
    voice.start(allowCloudFallback).then((started) => {
      if (!started) safeHaptics('light');
    });
  };

  const handleFinish = (): void => {
    finishedAtRef.current = Date.now();
    voice.finish().catch(() => undefined);
  };

  const handleStop = (): void => {
    // A quick transcription can already be working when the second tap lands.
    if (Date.now() - finishedAtRef.current < STOP_AFTER_SEND_GRACE_MS) return;
    if (voice.state === 'transcribing') voice.cancel().catch(() => undefined);
    else onCancelTurn();
  };

  const handleSwitchToTyping = (): void => {
    setFocusComposer(true);
    voice.cancel().catch(() => undefined);
  };

  return (
    <View
      className="px-4 pt-2"
      style={{
        paddingBottom:
          keyboardHeight > 0 ? keyboardHeight + COMPOSER_KEYBOARD_GAP : restingBottomPadding,
      }}
    >
      {notice}
      {voice.state === 'listening' ? (
        <ChatVoicePanel
          elapsedSeconds={voice.elapsedSeconds}
          audioRecorder={voice.audioRecorder}
          onCancel={() => voice.cancel().catch(() => undefined)}
          onSwitchToTyping={handleSwitchToTyping}
          onSend={handleFinish}
        />
      ) : (
        <ChatComposer
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          busy={busy}
          disabled={disabled}
          onSend={onSend}
          onMicPress={() => onMicPress(startVoice)}
          micDisabled={voice.isSettling}
          onStop={canStop ? handleStop : undefined}
          autoFocus={focusComposer}
        />
      )}
    </View>
  );
}
