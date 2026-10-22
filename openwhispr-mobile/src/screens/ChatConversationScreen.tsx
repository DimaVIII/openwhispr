import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabScreenHeader } from '@/components/ui/TabScreenHeader';
import { GlassBackButton } from '@/components/ui/GlassBackButton';
import { ChatAssistantMessage } from '@/components/chat/ChatAssistantMessage';
import { ChatErrorRow } from '@/components/chat/ChatErrorRow';
import { ChatInputBar } from '@/components/chat/ChatInputBar';
import { ChatSteps } from '@/components/chat/ChatSteps';
import { ChatTranscribingBubble } from '@/components/chat/ChatTranscribingBubble';
import { ChatUserBubble } from '@/components/chat/ChatUserBubble';
import { ChatWatermark } from '@/components/chat/ChatWatermark';
import { useChatSendGate } from '@/hooks/useChatSendGate';
import { useChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { chatTabGateOptions } from '@/lib/chat/chatConsent';
import { CHAT_HOME_ROUTE, NEW_CHAT_ID } from '@/lib/chat/chatRoutes';
import { useChatStore } from '@/store/useChatStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';

export function ChatConversationScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id && id !== NEW_CHAT_ID ? id : null;
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState('');

  const messages = useChatStore((s) => s.messages);
  const pending = useChatStore((s) => s.pending);
  const failure = useChatStore((s) => s.failure);
  const title = useChatStore(
    (s) => s.conversations.find((conversation) => conversation.id === conversationId)?.title,
  );
  const activeMode = useProcessingModeStore((s) => s.activeMode);
  const { chatEnabled, gate } = useChatSendGate();

  const adoptConversation = useCallback(
    (newId: string): void => {
      if (!conversationId) router.setParams({ id: newId });
    },
    [conversationId],
  );
  const voice = useChatVoiceInput({ conversationId, onSent: adoptConversation });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useFocusEffect(
    useCallback(() => {
      const store = useChatStore.getState();
      store.loadConversations();
      if (conversationId) store.openConversation(conversationId);
      else store.closeConversation();
      return () => {
        // A question still being spoken is dropped; one already transcribing may still send.
        if (voiceRef.current.state === 'listening')
          voiceRef.current.cancel().catch(() => undefined);
        useChatStore.getState().closeConversation();
      };
    }, [conversationId]),
  );

  // The bar's padding grows with the keyboard, which shrinks the list without changing its content.
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
    return () => subscription.remove();
  }, []);

  // A new chat's pending turn carries null until send creates the conversation.
  const pendingHere = pending?.conversationId === conversationId ? pending : null;
  const failureHere = failure && failure.conversationId === conversationId ? failure : null;
  // One turn runs at a time across every chat, so a turn elsewhere locks this composer too.
  const busy = pending !== null || voice.state === 'transcribing';
  const gateOptions = chatTabGateOptions(activeMode);

  const handleSend = (): void => {
    const question = draft.trim();
    if (!question || busy) return;
    gate((allowCloudFallback) => {
      const result = useChatStore.getState().send(question, { conversationId, allowCloudFallback });
      if (!result) return;
      setDraft('');
      adoptConversation(result.conversationId);
    }, gateOptions);
  };

  const handleRetry = (): void => {
    if (!chatEnabled || voiceRef.current.state !== 'idle') return;
    gate((allowCloudFallback) => {
      useChatStore
        .getState()
        .retry({ allowCloudFallback })
        .catch(() => undefined);
    }, gateOptions);
  };

  const handleEditQuestion = (): void => {
    const question = useChatStore.getState().editFailedQuestion();
    if (question !== null) setDraft(question);
  };

  const openNote = (noteId: number): void => {
    // Leaving mid-question would drop what's being said.
    if (voiceRef.current.state !== 'idle') return;
    router.push(`/(tabs)/(notes)/${noteId}`);
  };

  return (
    <View className="flex-1 bg-systemBackground">
      <ChatWatermark />
      <TabScreenHeader
        title={title ?? 'New chat'}
        left={<GlassBackButton fallbackRoute={CHAT_HOME_ROUTE} />}
      />

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={styles.messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((message) =>
          message.role === 'user' ? (
            <ChatUserBubble key={message.id} text={message.text} />
          ) : (
            <ChatAssistantMessage key={message.id} message={message} onOpenNote={openNote} />
          ),
        )}
        {pendingHere?.phase === 'transcribing' ? (
          <ChatTranscribingBubble elapsedSeconds={voice.elapsedSeconds} />
        ) : null}
        {pendingHere?.phase === 'working' ? (
          <ChatSteps
            steps={pendingHere.steps}
            variant="working"
            startedAt={pendingHere.startedAt}
          />
        ) : null}
        {failureHere ? (
          <ChatErrorRow
            message={failureHere.message}
            onRetry={handleRetry}
            onEdit={handleEditQuestion}
          />
        ) : null}
      </ScrollView>

      <ChatInputBar
        voice={voice}
        value={draft}
        onChangeText={setDraft}
        placeholder="Reply"
        busy={busy}
        disabled={!chatEnabled}
        onSend={handleSend}
        onMicPress={(startVoice) => {
          if (!busy) gate(startVoice, gateOptions);
        }}
        onCancelTurn={() => useChatStore.getState().cancel()}
        restingBottomPadding={Math.max(insets.bottom, 14)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  messages: { flexGrow: 1, justifyContent: 'flex-end', padding: 16, gap: 16 },
});
