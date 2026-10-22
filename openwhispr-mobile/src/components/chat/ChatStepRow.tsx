import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { BRAND } from '@/config/colors';
import { useLoopValue } from './useChatMotion';

export type ChatStepRowState = 'done' | 'active' | 'pending';

interface ChatStepRowProps {
  state: ChatStepRowState;
  label: string;
  detail?: string;
}

// A static ring under reduced motion: useLoopValue holds at 0, so it never turns.
function ChatSpinner(): React.JSX.Element {
  const turn = useLoopValue(900, false);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  return (
    <Animated.View
      style={[
        {
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: 'rgba(0,0,0,0.12)',
          borderTopColor: BRAND,
        },
        style,
      ]}
    />
  );
}

function StepMarker({ state }: { state: ChatStepRowState }): React.JSX.Element {
  if (state === 'done') {
    return (
      <View className="h-5 w-5 items-center justify-center rounded-full bg-[#E6F3EA]">
        <SystemIcon name="checkmark" mdName="Check" size={11} color="#1E7A3D" />
      </View>
    );
  }
  if (state === 'active') {
    return (
      <View className="h-5 w-5 items-center justify-center">
        <ChatSpinner />
      </View>
    );
  }
  return <View className="h-5 w-5 rounded-full border-2 border-[rgba(0,0,0,0.12)]" />;
}

export function ChatStepRow({ state, label, detail }: ChatStepRowProps): React.JSX.Element {
  return (
    <View className={`flex-row items-start gap-2.5 ${state === 'pending' ? 'opacity-40' : ''}`}>
      <StepMarker state={state} />
      <View className="flex-1">
        <Text className="text-[14px] leading-5 text-[#111113]">{label}</Text>
        {detail ? (
          <Text className="text-[13px] leading-[18px] text-[#6B6B70]">{detail}</Text>
        ) : null}
      </View>
    </View>
  );
}
