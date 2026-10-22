import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui/Text';
import { RecordingBars } from '@/components/features/WaveformVisualizer';
import { useAudioWaveform } from '@/hooks/useAudioWaveform';
import { BRAND_GRADIENT, CHAT_COLORS } from '@/config/colors';
import { formatElapsed } from './formatElapsed';

interface ChatVoicePanelProps {
  elapsedSeconds: number;
  audioRecorder: Parameters<typeof useAudioWaveform>[0];
  onCancel: () => void;
  onSwitchToTyping: () => void;
  onSend: () => void;
}

export function ChatVoicePanel({
  elapsedSeconds,
  audioRecorder,
  onCancel,
  onSwitchToTyping,
  onSend,
}: ChatVoicePanelProps): React.JSX.Element {
  // The panel only shows while listening.
  const { waveformData, currentAmplitude } = useAudioWaveform(audioRecorder, true);

  return (
    <View className="gap-3 bg-secondarySystemGroupedBackground p-4" style={styles.panel}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="h-2.5 w-2.5 rounded-full" style={styles.dot} />
          <Text className="text-[16px] font-semibold text-label">Listening</Text>
        </View>
        <Text className="text-[15px] text-secondaryLabel">{formatElapsed(elapsedSeconds)}</Text>
      </View>
      <View className="items-center">
        <RecordingBars
          isRecording
          color={BRAND_GRADIENT[1]}
          height={44}
          amplitude={currentAmplitude}
          waveformData={waveformData}
        />
      </View>
      <Text className="text-[13px] leading-[18px] text-secondaryLabel">
        Tap send when you’re done. Your question is transcribed, then asked.
      </Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          className="min-h-[44px] items-center justify-center rounded-[10px] px-4 active:opacity-70"
          style={styles.cancel}
        >
          <Text className="text-[15px] font-medium text-label">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to typing"
          onPress={onSwitchToTyping}
          className="min-h-[44px] flex-1 items-center justify-center active:opacity-70"
        >
          <Text className="text-[15px] font-medium text-secondaryLabel">Switch to typing</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={onSend}
          className="overflow-hidden active:opacity-80"
          style={styles.sendWrap}
        >
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendFill}
          >
            <Text className="text-[15px] font-semibold text-white">Send</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHAT_COLORS.hairline,
  },
  dot: { backgroundColor: CHAT_COLORS.recordingDot },
  cancel: { borderWidth: StyleSheet.hairlineWidth, borderColor: CHAT_COLORS.hairline },
  sendWrap: { borderRadius: 10, borderCurve: 'continuous' },
  sendFill: {
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
