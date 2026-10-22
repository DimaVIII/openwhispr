import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import type { ChatSuggestion } from '@/lib/chat/chatSuggestions';

interface ChatSuggestionCardsProps {
  suggestions: ChatSuggestion[];
  onPress: (suggestion: ChatSuggestion) => void;
  disabled: boolean;
}

const ICONS: Record<
  ChatSuggestion['kind'],
  { name: string; mdName: 'Calendar' | 'FileText' | 'Check' }
> = {
  calendar: { name: 'calendar', mdName: 'Calendar' },
  note: { name: 'doc.text', mdName: 'FileText' },
  actions: { name: 'checkmark', mdName: 'Check' },
};

export function ChatSuggestionCards({
  suggestions,
  onPress,
  disabled,
}: ChatSuggestionCardsProps): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
    >
      {suggestions.map((suggestion) => {
        const icon = ICONS[suggestion.kind];
        return (
          <Pressable
            key={`${suggestion.kind}:${suggestion.label}`}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onPress(suggestion)}
            className="justify-between border border-[rgba(0,0,0,0.08)] bg-white p-3 active:opacity-70"
            style={{
              width: 218,
              height: 112,
              borderRadius: 14,
              borderCurve: 'continuous',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <View className="flex-row items-center gap-1.5">
              <SystemIcon name={icon.name} mdName={icon.mdName} size={14} color="#5F5F66" />
              <Text className="shrink text-[12px] text-[#6B6B70]" numberOfLines={1}>
                {suggestion.meta}
              </Text>
            </View>
            <Text
              className="text-[16px] font-medium leading-[21px] text-[#111113]"
              numberOfLines={3}
            >
              {suggestion.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
