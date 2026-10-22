import { Pressable, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { BRAND_GRADIENT } from '@/config/colors';

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

const BUTTON_SIZE = 40;
const BUTTON_RADIUS = 13;

function GradientButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <LinearGradient
        colors={BRAND_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: BUTTON_RADIUS,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
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
      className="flex-row items-end gap-2 border border-[rgba(0,0,0,0.08)] bg-white py-2 pl-4 pr-2"
      style={{ borderRadius: 18, borderCurve: 'continuous' }}
    >
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6B6B70"
        editable={!busy && !disabled}
        multiline
        className="max-h-[120px] min-h-[40px] flex-1 py-2 text-[16px] leading-[22px] text-[#111113]"
      />
      {busy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={onStop}
          hitSlop={2}
          className="items-center justify-center bg-[#111113]"
          style={{
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            borderRadius: BUTTON_RADIUS,
            borderCurve: 'continuous',
          }}
        >
          <View className="h-3.5 w-3.5 rounded-[4px] bg-white" />
        </Pressable>
      ) : hasText ? (
        <GradientButton label="Send" disabled={disabled} onPress={onSend}>
          <SystemIcon name="arrow.up" mdName="ArrowUp" size={18} color="#FFFFFF" />
        </GradientButton>
      ) : (
        <GradientButton label="Speak your question" disabled={disabled} onPress={onMicPress}>
          <SystemIcon name="mic.fill" mdName="Mic" size={18} color="#FFFFFF" />
        </GradientButton>
      )}
    </View>
  );
}
