import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { TabScreenHeader } from '@/components/ui/TabScreenHeader';
import { GlassIconButton } from '@/components/ui/GlassIconButton';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatRecentList } from '@/components/chat/ChatRecentList';
import { ChatSuggestionCards } from '@/components/chat/ChatSuggestionCards';
import { ChatTurnedOff } from '@/components/chat/ChatTurnedOff';
import { ChatVoicePanel } from '@/components/chat/ChatVoicePanel';
import { TAB_BAR_CLEARANCE } from '@/components/chat/tabBarClearance';
import { calendarRepository, notesRepository } from '@/data';
import { useChatSendGate } from '@/hooks/useChatSendGate';
import { useChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { getMeetingCalendarEventSuggestions } from '@/lib/calendar/meetingSuggestions';
import { chatTabGateOptions } from '@/lib/chat/chatConsent';
import { CHAT_HISTORY_ROUTE, chatConversationRoute, NEW_CHAT_ID } from '@/lib/chat/chatRoutes';
import { buildChatSuggestions, type ChatSuggestion } from '@/lib/chat/chatSuggestions';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import { safeHaptics } from '@/lib/utils';
import { useChatStore } from '@/store/useChatStore';
import { useGoogleCalendarStore } from '@/store/useGoogleCalendarStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';

const RECENT_CONVERSATION_COUNT = 4;
const RECENT_MEETING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const RECENT_NOTE_POOL = 20;
const COMPOSER_KEYBOARD_GAP = 10;

const greetingFor = (date: Date): string => {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const loadSuggestions = (now: Date): ChatSuggestion[] => {
  const { accounts } = useGoogleCalendarStore.getState();
  // buildChatSuggestions needs a start time, which an all-day event doesn't have.
  const nextEvent =
    getMeetingCalendarEventSuggestions(accounts, calendarRepository, now).find(
      (event) => !event.allDay,
    ) ?? null;
  const cutoff = now.getTime() - RECENT_MEETING_WINDOW_MS;
  // Candidates come newest first, so the first meeting is the newest one.
  const recentMeetingNote =
    notesRepository
      .getChatCandidateNotes([], { includePrivate: false, limit: RECENT_NOTE_POOL })
      .find(
        (note) =>
          note.noteType === 'meeting' &&
          (tryParseNoteTimestamp(note.updatedAt)?.getTime() ?? 0) >= cutoff,
      ) ?? null;
  return buildChatSuggestions({ nextEvent, recentMeetingNote, now });
};

const openConversation = (conversationId: string): void => {
  router.push(chatConversationRoute(conversationId));
};

export function ChatHomeScreen(): React.JSX.Element {
  const keyboardHeight = useKeyboardHeight();
  const [draft, setDraft] = useState('');
  const [focusComposer, setFocusComposer] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);

  const conversations = useChatStore((s) => s.conversations);
  const pending = useChatStore((s) => s.pending);
  const activeMode = useProcessingModeStore((s) => s.activeMode);
  const { chatEnabled, gate } = useChatSendGate();
  const voice = useChatVoiceInput({ conversationId: null, onSent: openConversation });

  useFocusEffect(
    useCallback(() => {
      let focused = true;
      const refresh = (): void => {
        if (!focused) return;
        const current = new Date();
        setNow(current);
        setSuggestions(loadSuggestions(current));
      };
      useChatStore.getState().loadConversations();
      refresh();
      // Loading also refreshes the calendar accounts runChatTurn reads.
      useGoogleCalendarStore
        .getState()
        .load()
        .catch(() => undefined)
        .then(refresh);
      return () => {
        focused = false;
      };
    }, []),
  );

  // One turn runs at a time across every chat, so any pending turn locks Home too.
  const busy = pending !== null || voice.state === 'transcribing';
  const gateOptions = chatTabGateOptions(activeMode);

  const ask = (question: string, clearDraft: boolean): void => {
    if (!question.trim() || busy) return;
    gate((allowCloudFallback) => {
      const result = useChatStore
        .getState()
        .send(question, { conversationId: null, allowCloudFallback });
      if (!result) return;
      if (clearDraft) setDraft('');
      openConversation(result.conversationId);
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

  const handleSwitchToTyping = (): void => {
    setFocusComposer(true);
    voice.cancel().catch(() => undefined);
  };

  const headerButtons = (
    <View className="flex-row gap-3">
      <GlassIconButton
        accessibilityLabel="All chats"
        onPress={() => router.push(CHAT_HISTORY_ROUTE)}
      >
        <SystemIcon name="clock.arrow.circlepath" mdName="History" size={18} color="brand" />
      </GlassIconButton>
      <GlassIconButton accessibilityLabel="New chat" onPress={() => openConversation(NEW_CHAT_ID)}>
        <SystemIcon name="square.and.pencil" mdName="SquarePen" size={18} color="brand" />
      </GlassIconButton>
    </View>
  );

  return (
    <View className="flex-1 bg-systemBackground">
      <TabScreenHeader title="Chat" right={headerButtons} />

      {chatEnabled ? (
        <>
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-7 pb-6 pt-4"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="px-4">
              <Text className="text-[28px] font-bold text-label">{greetingFor(now)}</Text>
              <Text className="mt-1 text-[16px] leading-[22px] text-secondaryLabel">
                Ask about your notes and meetings, or anything else.
              </Text>
            </View>

            <View className="gap-3">
              <Text
                accessibilityRole="header"
                className="px-4 text-[17px] font-semibold text-label"
              >
                From your day
              </Text>
              <ChatSuggestionCards
                suggestions={suggestions}
                disabled={busy}
                onPress={(suggestion) => ask(suggestion.prompt, false)}
              />
            </View>

            <ChatRecentList
              conversations={conversations.slice(0, RECENT_CONVERSATION_COUNT)}
              onOpen={openConversation}
              onSeeAll={() => router.push(CHAT_HISTORY_ROUTE)}
            />
          </ScrollView>

          <View
            className="px-4 pt-2"
            style={{
              paddingBottom:
                keyboardHeight > 0 ? keyboardHeight + COMPOSER_KEYBOARD_GAP : TAB_BAR_CLEARANCE,
            }}
          >
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
                placeholder="Ask anything"
                busy={busy}
                disabled={false}
                onSend={() => ask(draft, true)}
                onMicPress={handleMicPress}
                onStop={handleStop}
                autoFocus={focusComposer}
              />
            )}
          </View>
        </>
      ) : (
        <ChatTurnedOff onOpenAIModels={() => router.push('/(account)/ai-models')} />
      )}
    </View>
  );
}
