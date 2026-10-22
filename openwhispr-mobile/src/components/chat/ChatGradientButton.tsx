import { Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_GRADIENT } from '@/config/colors';

export const COMPOSER_BUTTON_SIZE = 40;
export const COMPOSER_BUTTON_RADIUS = 13;

interface ChatGradientButtonProps {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}

export function ChatGradientButton({
  label,
  disabled,
  onPress,
  children,
}: ChatGradientButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={disabled ? styles.disabled : undefined}
    >
      <LinearGradient
        colors={BRAND_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  fill: {
    width: COMPOSER_BUTTON_SIZE,
    height: COMPOSER_BUTTON_SIZE,
    borderRadius: COMPOSER_BUTTON_RADIUS,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
