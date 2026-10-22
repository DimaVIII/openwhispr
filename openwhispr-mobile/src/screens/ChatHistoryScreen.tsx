import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { TabScreenHeader } from '@/components/ui/TabScreenHeader';
import { GlassBackButton } from '@/components/ui/GlassBackButton';
import { SwipeableCard } from '@/components/ui/SwipeableCard';
import { ChatConversationRow } from '@/components/chat/ChatConversationRow';
import { TAB_BAR_CLEARANCE } from '@/components/ui/tabBarClearance';
import { CHAT_HOME_ROUTE, chatConversationRoute } from '@/lib/chat/chatRoutes';
import { safeHaptics } from '@/lib/utils';
import { useChatStore } from '@/store/useChatStore';

export function ChatHistoryScreen(): React.JSX.Element {
  const conversations = useChatStore((s) => s.conversations);
  // SwipeableCard slides a row away before asking, so a cancelled delete remounts the rows at rest.
  const [rowsVersion, setRowsVersion] = useState(0);

  const restoreRows = (): void => setRowsVersion((version) => version + 1);

  // A screen reader deletes without swiping, so nothing needs restoring, and a remount would move
  // its focus.
  const confirmDelete = (conversationId: string, onCancel?: () => void): void => {
    safeHaptics('warning');
    Alert.alert(
      'Delete this chat?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel', onPress: onCancel },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => useChatStore.getState().deleteConversation(conversationId),
        },
      ],
      { onDismiss: onCancel },
    );
  };

  useFocusEffect(
    useCallback(() => {
      useChatStore.getState().loadConversations();
    }, []),
  );

  return (
    <View className="flex-1 bg-systemBackground">
      <TabScreenHeader
        title="All chats"
        left={<GlassBackButton fallbackRoute={CHAT_HOME_ROUTE} />}
      />
      {conversations.length > 0 ? (
        <ScrollView
          contentContainerClassName="pt-3"
          contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }}
          showsVerticalScrollIndicator={false}
        >
          {conversations.map((conversation) => (
            <SwipeableCard
              key={`${conversation.id}:${rowsVersion}`}
              onDelete={() => confirmDelete(conversation.id, restoreRows)}
            >
              <ChatConversationRow
                conversation={conversation}
                onPress={() => router.push(chatConversationRoute(conversation.id))}
                onDelete={() => confirmDelete(conversation.id)}
              />
            </SwipeableCard>
          ))}
        </ScrollView>
      ) : (
        <Text className="px-4 py-6 text-center text-[15px] text-secondaryLabel">
          Your chats will show up here.
        </Text>
      )}
    </View>
  );
}
