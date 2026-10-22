import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { BRAND_GRADIENT } from '@/config/colors';
import type { ChatStep, ChatStepId } from '@/lib/chat/types';
import { ChatStepRow } from './ChatStepRow';
import { formatElapsed } from './formatElapsed';
import { useLoopValue, usePulseStyle } from './useChatMotion';

interface ChatStepsProps {
  steps: ChatStep[];
  variant: 'working' | 'done';
  sourceCount?: number;
  /** Epoch ms when the turn began; without it "Still working" never shows. */
  startedAt?: number;
}

const SLOW_AFTER_MS = 15_000;
const PROGRESS_TRACK_WIDTH = 120;

// A turn runs these in order; the ones after the latest reported step show as pending.
const PIPELINE: { id: ChatStepId; label: string }[] = [
  { id: 'calendar', label: 'Checking your calendar' },
  { id: 'search', label: 'Searching your notes' },
  { id: 'read', label: 'Reading your notes' },
  { id: 'write', label: 'Writing your answer' },
];

const sourcesLabel = (count: number): string => {
  if (count === 0) return 'Searched your notes · no matches';
  return `Searched your notes · ${count} ${count === 1 ? 'source' : 'sources'}`;
};

const pendingSteps = (steps: ChatStep[]): { id: ChatStepId; label: string }[] => {
  const lastReported = Math.max(
    -1,
    ...steps.map((step) => PIPELINE.findIndex((p) => p.id === step.id)),
  );
  return PIPELINE.slice(lastReported + 1);
};

function Sparkle(): React.JSX.Element {
  const pulse = usePulseStyle(0.6, 1100);
  return (
    <Animated.View
      style={[
        { width: 30, height: 30, borderRadius: 9, borderCurve: 'continuous', overflow: 'hidden' },
        pulse,
      ]}
    >
      <LinearGradient
        colors={BRAND_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <SystemIcon name="sparkles" mdName="Sparkles" size={16} color="#FFFFFF" />
      </LinearGradient>
    </Animated.View>
  );
}

function SweepingProgress(): React.JSX.Element {
  const sweep = useLoopValue(1400, false);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: -PROGRESS_TRACK_WIDTH * 0.4 + sweep.value * PROGRESS_TRACK_WIDTH * 1.4 },
    ],
  }));
  return (
    <View
      className="h-1 overflow-hidden rounded-full bg-[rgba(0,0,0,0.06)]"
      style={{ width: PROGRESS_TRACK_WIDTH }}
    >
      <Animated.View
        style={[{ width: PROGRESS_TRACK_WIDTH * 0.4, height: 4, borderRadius: 2 }, style]}
      >
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

function SlowNotice({ elapsedSeconds }: { elapsedSeconds: number }): React.JSX.Element {
  return (
    <View className="mt-3 gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-[14px] font-semibold text-[#111113]">Still working</Text>
        <Text className="text-[13px] text-[#6B6B70]">{formatElapsed(elapsedSeconds)}</Text>
      </View>
      <SweepingProgress />
      <Text className="text-[13px] leading-[18px] text-[#6B6B70]">
        Questions that span many notes can take up to a minute.
      </Text>
    </View>
  );
}

export function ChatSteps({
  steps,
  variant,
  sourceCount = 0,
  startedAt,
}: ChatStepsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const working = variant === 'working';
  const labelPulse = usePulseStyle(0.45, 1000, working);

  useEffect(() => {
    if (!working) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [working]);

  const activeStep = steps.find((step) => step.status === 'active');
  const headerLabel = working ? (activeStep?.label ?? 'Thinking…') : sourcesLabel(sourceCount);
  const elapsedMs = working && startedAt != null ? now - startedAt : 0;
  const slow = working && startedAt != null && elapsedMs >= SLOW_AFTER_MS;

  return (
    <View
      className={slow ? 'rounded-[14px] border border-[rgba(0,0,0,0.08)] bg-white p-3' : undefined}
      style={slow ? { borderCurve: 'continuous' } : undefined}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        className="min-h-[44px] flex-row items-center gap-2.5 active:opacity-70"
      >
        {working ? (
          <Sparkle />
        ) : (
          <View className="h-5 w-5 items-center justify-center rounded-full bg-[#E6F3EA]">
            <SystemIcon name="checkmark" mdName="Check" size={11} color="#1E7A3D" />
          </View>
        )}
        <Animated.View style={[{ flexShrink: 1 }, working ? labelPulse : null]}>
          <Text
            className={
              working ? 'text-[15px] font-medium text-[#111113]' : 'text-[14px] text-[#5F5F66]'
            }
            numberOfLines={1}
          >
            {headerLabel}
          </Text>
        </Animated.View>
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <SystemIcon name="chevron.down" mdName="ChevronDown" size={16} color="#6B6B70" />
        </View>
      </Pressable>

      {slow ? <SlowNotice elapsedSeconds={Math.floor(elapsedMs / 1000)} /> : null}

      {expanded ? (
        <View className="mt-2 gap-2.5 pb-1">
          {steps.map((step) => (
            <ChatStepRow
              key={step.id}
              state={step.status}
              label={step.label}
              detail={step.detail}
            />
          ))}
          {working
            ? pendingSteps(steps).map((step) => (
                <ChatStepRow key={step.id} state="pending" label={step.label} />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}
