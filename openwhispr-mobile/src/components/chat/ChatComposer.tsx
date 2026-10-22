import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { CHAT_COLORS, iosColor } from '@/config/colors';
import {
  ChatGradientButton,
  COMPOSER_BUTTON_RADIUS,
  COMPOSER_BUTTON_SIZE,
} from './ChatGradientButton';

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onSend: () => void;
  onMicPress: () => void;
  onStop: () => void;
}

export function ChatComposer({
  value,
  onChangeText,
  placeholder,
  busy,
  disabled,
  onSend,
  onMicPress,
  onStop,
}: ChatComposerProps): React.JSX.Element {
  const hasText = value.trim().length > 0;

  return (
    <View
      className="flex-row items-end gap-2 bg-secondarySystemGroupedBackground py-2 pl-4 pr-2"
      style={styles.container}
    >
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={iosColor('tertiaryLabel')}
        editable={!busy && !disabled}
        multiline
        className="max-h-[120px] min-h-[40px] flex-1 py-2 text-[16px] leading-[22px] text-label"
      />
      {busy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={onStop}
          hitSlop={2}
          className="items-center justify-center"
          style={styles.stop}
        >
          <View className="h-3.5 w-3.5 rounded-[4px] bg-white" />
        </Pressable>
      ) : hasText ? (
        <ChatGradientButton label="Send" disabled={disabled} onPress={onSend}>
          <SystemIcon name="arrow.up" mdName="ArrowUp" size={18} color={CHAT_COLORS.onGradient} />
        </ChatGradientButton>
      ) : (
        <ChatGradientButton label="Speak your question" disabled={disabled} onPress={onMicPress}>
          <SystemIcon name="mic.fill" mdName="Mic" size={18} color={CHAT_COLORS.onGradient} />
        </ChatGradientButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHAT_COLORS.hairline,
  },
  stop: {
    width: COMPOSER_BUTTON_SIZE,
    height: COMPOSER_BUTTON_SIZE,
    borderRadius: COMPOSER_BUTTON_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: CHAT_COLORS.stopButton,
  },
});
