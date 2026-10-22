import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';

interface ChatErrorRowProps {
  message: string;
  onRetry: () => void;
  onEdit: () => void;
}

export function ChatErrorRow({ message, onRetry, onEdit }: ChatErrorRowProps): React.JSX.Element {
  return (
    <View className="flex-row gap-3" accessibilityRole="alert">
      <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-[#FBECEA]">
        <SystemIcon
          name="exclamationmark.triangle"
          mdName="TriangleAlert"
          size={16}
          color="#B3261E"
        />
      </View>
      <View className="flex-1">
        <Text className="text-[16px] font-semibold text-[#111113]">Couldn’t get an answer</Text>
        <Text className="mt-0.5 text-[14px] leading-5 text-[#5F5F66]">{message}</Text>
        <View className="mt-3 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={onRetry}
            className="min-h-[44px] items-center justify-center rounded-[10px] bg-[#111113] px-4 active:opacity-70"
          >
            <Text className="text-[15px] font-medium text-white">Retry</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit question"
            onPress={onEdit}
            className="min-h-[44px] items-center justify-center rounded-[10px] border border-[rgba(0,0,0,0.08)] bg-white px-4 active:opacity-70"
          >
            <Text className="text-[15px] font-medium text-[#111113]">Edit question</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
