import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabScreenHeader } from '@/components/ui/TabScreenHeader';
import { GlassBackButton } from '@/components/ui/GlassBackButton';
import { ChatAssistantMessage } from '@/components/chat/ChatAssistantMessage';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatErrorRow } from '@/components/chat/ChatErrorRow';
import { ChatSteps } from '@/components/chat/ChatSteps';
import { ChatTranscribingBubble } from '@/components/chat/ChatTranscribingBubble';
import { ChatUserBubble } from '@/components/chat/ChatUserBubble';
import { ChatVoicePanel } from '@/components/chat/ChatVoicePanel';
import { ChatWatermark } from '@/components/chat/ChatWatermark';
import { useChatSendGate } from '@/hooks/useChatSendGate';
import { useChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { chatTabGateOptions } from '@/lib/chat/chatConsent';
import { CHAT_HOME_ROUTE, NEW_CHAT_ID } from '@/lib/chat/chatRoutes';
import { safeHaptics } from '@/lib/utils';
import { useChatStore } from '@/store/useChatStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';

const COMPOSER_KEYBOARD_GAP = 10;

export function ChatConversationScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id && id !== NEW_CHAT_ID ? id : null;
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState('');
  const [focusComposer, setFocusComposer] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      const store = useChatStore.getState();
      store.loadConversations();
      if (conversationId) store.openConversation(conversationId);
      else store.closeConversation();
      return () => useChatStore.getState().closeConversation();
    }, [conversationId]),
  );

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

  const handleMicPress = (): void => {
    if (busy) return;
    gate((allowCloudFallback) => {
      setFocusComposer(false);
      voice.start(allowCloudFallback).then((started) => {
        if (!started) safeHaptics('light');
      });
    }, gateOptions);
  };

  const handleStop = (): void => {
    if (voice.state === 'transcribing') voice.cancel().catch(() => undefined);
    else useChatStore.getState().cancel();
  };

  const handleRetry = (): void => {
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

  const handleSwitchToTyping = (): void => {
    setFocusComposer(true);
    voice.cancel().catch(() => undefined);
  };

  const openNote = (noteId: number): void => {
    router.push(`/(tabs)/(notes)/${noteId}`);
  };

  const bottomPad =
    keyboardHeight > 0 ? keyboardHeight + COMPOSER_KEYBOARD_GAP : Math.max(insets.bottom, 14);

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

      <View className="px-4 pt-2" style={{ paddingBottom: bottomPad }}>
        {voice.state === 'listening' ? (
          <ChatVoicePanel
            elapsedSeconds={voice.elapsedSeconds}
            audioRecorder={voice.audioRecorder}
            isRecording
            onCancel={() => voice.cancel().catch(() => undefined)}
            onSwitchToTyping={handleSwitchToTyping}
            onSend={() => voice.finish().catch(() => undefined)}
          />
        ) : (
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            placeholder="Reply"
            busy={busy}
            disabled={!chatEnabled}
            onSend={handleSend}
            onMicPress={handleMicPress}
            onStop={handleStop}
            autoFocus={focusComposer}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  messages: { flexGrow: 1, justifyContent: 'flex-end', padding: 16, gap: 16 },
});
