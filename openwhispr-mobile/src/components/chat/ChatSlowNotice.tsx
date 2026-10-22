import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui/Text';
import { BRAND_GRADIENT, CHAT_COLORS } from '@/config/colors';
import { formatElapsed } from './formatElapsed';
import { useLoopValue } from './useChatMotion';

const TRACK_WIDTH = 120;
const BAR_WIDTH = TRACK_WIDTH * 0.4;

function SweepingProgress(): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const sweep = useLoopValue(1400, false);
  // Reduced motion leaves a static partial fill at the start of the track
  // rather than parking the bar off to the left.
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: reducedMotion ? 0 : -BAR_WIDTH + sweep.value * (TRACK_WIDTH + BAR_WIDTH) },
    ],
  }));
  return (
    <View className="overflow-hidden rounded-full" style={styles.track}>
      <Animated.View style={[styles.bar, style]}>
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fill}
        />
      </Animated.View>
    </View>
  );
}

export function ChatSlowNotice({ elapsedSeconds }: { elapsedSeconds: number }): React.JSX.Element {
  return (
    <View className="mt-3 gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-[14px] font-semibold text-label">Still working</Text>
        <Text className="text-[13px] text-secondaryLabel">{formatElapsed(elapsedSeconds)}</Text>
      </View>
      <SweepingProgress />
      <Text className="text-[13px] leading-[18px] text-secondaryLabel">
        Questions that span many notes can take up to a minute.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: TRACK_WIDTH, height: 4, backgroundColor: CHAT_COLORS.neutralTrack },
  bar: { width: BAR_WIDTH, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { flex: 1 },
});
