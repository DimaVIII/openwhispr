import { useState } from 'react';
import { View } from 'react-native';
import type { ChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { safeHaptics } from '@/lib/utils';
import { ChatComposer } from './ChatComposer';
import { ChatVoicePanel } from './ChatVoicePanel';

const COMPOSER_KEYBOARD_GAP = 10;

export type StartVoice = (allowCloudFallback: boolean) => void;

interface ChatInputBarProps {
  voice: ChatVoiceInput;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onSend: () => void;
  /** Runs the screen's checks, then calls `startVoice` to open the mic. */
  onMicPress: (startVoice: StartVoice) => void;
  /** Stops the turn that's working; a transcribing question is stopped here. */
  onCancelTurn: () => void;
  /** Space below the bar while the keyboard is hidden. */
  restingBottomPadding: number;
}

/** The composer, or the voice panel while listening, kept above the keyboard. */
export function ChatInputBar({
  voice,
  value,
  onChangeText,
  placeholder,
  busy,
  disabled,
  onSend,
  onMicPress,
  onCancelTurn,
  restingBottomPadding,
}: ChatInputBarProps): React.JSX.Element {
  const keyboardHeight = useKeyboardHeight();
  // The composer unmounts while the voice panel shows, so it takes focus as it mounts again.
  const [focusComposer, setFocusComposer] = useState(false);

  const startVoice: StartVoice = (allowCloudFallback) => {
    setFocusComposer(false);
    voice.start(allowCloudFallback).then((started) => {
      if (!started) safeHaptics('light');
    });
  };

  const handleStop = (): void => {
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
      {voice.state === 'listening' ? (
        <ChatVoicePanel
          elapsedSeconds={voice.elapsedSeconds}
          audioRecorder={voice.audioRecorder}
          isRecording
          onCancel={() => voice.cancel().catch(() => undefined)}
          onSwitchToTyping={handleSwitchToTyping}
          onSend={() => voice.finish().catch(() => undefined)}
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
          onStop={handleStop}
          autoFocus={focusComposer}
        />
      )}
    </View>
  );
}
