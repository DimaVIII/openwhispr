import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { CHAT_COLORS } from '@/config/colors';
import type { ChatConversationSummary } from '@/lib/chat/types';
import { ChatConversationRow } from './ChatConversationRow';

interface ChatRecentListProps {
  conversations: ChatConversationSummary[];
  onOpen: (conversationId: string) => void;
  onSeeAll: () => void;
}

export function ChatRecentList({
  conversations,
  onOpen,
  onSeeAll,
}: ChatRecentListProps): React.JSX.Element {
  return (
    <View>
      <View className="flex-row items-center justify-between px-4">
        <Text accessibilityRole="header" className="text-[17px] font-semibold text-label">
          Recent
        </Text>
        {conversations.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSeeAll}
            className="min-h-[44px] justify-center pl-4 active:opacity-70"
          >
            <Text className="text-[15px] text-link">See all</Text>
          </Pressable>
        ) : null}
      </View>
      {conversations.length > 0 ? (
        <View
          className="mx-4 overflow-hidden bg-secondarySystemGroupedBackground"
          style={styles.card}
        >
          {conversations.map((conversation) => (
            <ChatConversationRow
              key={conversation.id}
              conversation={conversation}
              onPress={() => onOpen(conversation.id)}
            />
          ))}
        </View>
      ) : (
        <Text className="px-4 py-3 text-[15px] text-secondaryLabel">
          Your chats will show up here.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHAT_COLORS.hairline,
  },
});
