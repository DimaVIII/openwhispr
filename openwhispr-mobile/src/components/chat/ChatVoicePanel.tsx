import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui/Text';
import { RecordingBars } from '@/components/features/WaveformVisualizer';
import { useAudioWaveform } from '@/hooks/useAudioWaveform';
import { BRAND_GRADIENT } from '@/config/colors';
import { formatElapsed } from './formatElapsed';

interface ChatVoicePanelProps {
  elapsedSeconds: number;
  audioRecorder: Parameters<typeof useAudioWaveform>[0];
  isRecording: boolean;
  onCancel: () => void;
  onSwitchToTyping: () => void;
  onSend: () => void;
}

export function ChatVoicePanel({
  elapsedSeconds,
  audioRecorder,
  isRecording,
  onCancel,
  onSwitchToTyping,
  onSend,
}: ChatVoicePanelProps): React.JSX.Element {
  const { waveformData, currentAmplitude } = useAudioWaveform(audioRecorder, isRecording);

  return (
    <View
      className="gap-3 border border-[rgba(0,0,0,0.08)] bg-white p-4"
      style={{ borderRadius: 18, borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="h-2.5 w-2.5 rounded-full bg-[#E5342B]" />
          <Text className="text-[16px] font-semibold text-[#111113]">Listening</Text>
        </View>
        <Text className="text-[15px] text-[#5F5F66]">{formatElapsed(elapsedSeconds)}</Text>
      </View>
      <View className="items-center">
        <RecordingBars
          isRecording={isRecording}
          color={BRAND_GRADIENT[1]}
          height={44}
          amplitude={currentAmplitude}
          waveformData={waveformData}
        />
      </View>
      <Text className="text-[13px] leading-[18px] text-[#6B6B70]">
        Tap send when you’re done. Your question is transcribed, then asked.
      </Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          className="min-h-[44px] items-center justify-center rounded-[10px] border border-[rgba(0,0,0,0.08)] px-4 active:opacity-70"
        >
          <Text className="text-[15px] font-medium text-[#111113]">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to typing"
          onPress={onSwitchToTyping}
          className="min-h-[44px] flex-1 items-center justify-center active:opacity-70"
        >
          <Text className="text-[15px] font-medium text-[#5F5F66]">Switch to typing</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={onSend}
          className="overflow-hidden active:opacity-80"
          style={{ borderRadius: 10, borderCurve: 'continuous' }}
        >
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              minHeight: 44,
              paddingHorizontal: 20,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text className="text-[15px] font-semibold text-white">Send</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}
