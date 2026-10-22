import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { TabScreenHeader } from '@/components/ui/TabScreenHeader';
import { GlassIconButton } from '@/components/ui/GlassIconButton';
import { ChatComposerNotice } from '@/components/chat/ChatComposerNotice';
import { ChatInputBar } from '@/components/chat/ChatInputBar';
import { ChatRecentList } from '@/components/chat/ChatRecentList';
import { ChatSuggestionCards } from '@/components/chat/ChatSuggestionCards';
import { ChatTurnedOff } from '@/components/chat/ChatTurnedOff';
import { TAB_BAR_CLEARANCE } from '@/components/ui/tabBarClearance';
import { calendarRepository, notesRepository, type Note } from '@/data';
import { useChatSendGate } from '@/hooks/useChatSendGate';
import { useChatVoiceInput } from '@/hooks/useChatVoiceInput';
import { getMeetingCalendarEventSuggestions } from '@/lib/calendar/meetingSuggestions';
import { chatTabGateOptions } from '@/lib/chat/chatConsent';
import { lacksNoteText } from '@/lib/chat/chatContext';
import { withSpokenQuestion } from '@/lib/chat/chatDraft';
import { selectPendingTitle, workingElsewhereLabel } from '@/lib/chat/chatPending';
import {
  CHAT_HISTORY_ROUTE,
  CHAT_SETTINGS_ROUTE,
  chatConversationRoute,
  NEW_CHAT_ID,
} from '@/lib/chat/chatRoutes';
import { buildChatSuggestions, type ChatSuggestion } from '@/lib/chat/chatSuggestions';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import { useChatStore } from '@/store/useChatStore';
import { useGoogleCalendarStore } from '@/store/useGoogleCalendarStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';

const RECENT_CONVERSATION_COUNT = 4;
const RECENT_MEETING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const RECENT_NOTE_POOL = 20;
// Enough that a running meeting or a day of all-day events can't hide the next meeting worth
// prepping.
const SUGGESTION_EVENT_POOL = 50;
const UNFINISHED_TRANSCRIPTS = new Set(['recording', 'transcribing', 'diarizing']);

// A meeting still recording or transcribing, or one that failed with nothing typed, has nothing to
// ask about yet.
const isAskableMeeting = (note: Note): boolean => {
  const status = note.transcriptionStatus ?? 'idle';
  return (
    note.noteType === 'meeting' &&
    !UNFINISHED_TRANSCRIPTS.has(status) &&
    (status === 'done' || !lacksNoteText(note))
  );
};

const greetingFor = (date: Date): string => {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const loadSuggestions = (now: Date): ChatSuggestion[] => {
  const { accounts } = useGoogleCalendarStore.getState();
  const events = getMeetingCalendarEventSuggestions(
    accounts,
    calendarRepository,
    now,
    SUGGESTION_EVENT_POOL,
  );
  const cutoff = now.getTime() - RECENT_MEETING_WINDOW_MS;
  // Candidates come newest first, so the first meeting is the newest one.
  const recentMeetingNote =
    notesRepository
      .getChatCandidateNotes([], { includePrivate: false, limit: RECENT_NOTE_POOL })
      .notes.find(
        (note) =>
          isAskableMeeting(note) &&
          (tryParseNoteTimestamp(note.updatedAt)?.getTime() ?? 0) >= cutoff,
      ) ?? null;
  return buildChatSuggestions({ events, recentMeetingNote, now });
};

const pushConversation = (conversationId: string): void => {
  router.push(chatConversationRoute(conversationId));
};

export function ChatHomeScreen(): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const focusedRef = useRef(false);

  const conversations = useChatStore((s) => s.conversations);
  const pending = useChatStore((s) => s.pending);
  const pendingTitle = useChatStore(selectPendingTitle);
  const activeMode = useProcessingModeStore((s) => s.activeMode);
  const { chatEnabled, gate } = useChatSendGate();
  const voice = useChatVoiceInput({
    conversationId: null,
    // A question still transcribing when Home lost focus is sent, but doesn't pull the user back.
    onSent: (conversationId) => {
      if (focusedRef.current) pushConversation(conversationId);
    },
    onRouteChanged: (text) => setDraft((current) => withSpokenQuestion(current, text)),
    isFocused: () => focusedRef.current,
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useFocusEffect(
    useCallback(() => {
      let focused = true;
      focusedRef.current = true;
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
        focusedRef.current = false;
        if (voiceRef.current.state === 'listening')
          voiceRef.current.cancel().catch(() => undefined);
      };
    }, []),
  );

  // One turn runs at a time across every chat, so any pending turn locks Home too. Home is no
  // conversation, so the only thing it can stop is its own spoken question.
  const busy = pending !== null || voice.state === 'transcribing';
  const transcribingHere = voice.state === 'transcribing';
  const workingId = pending?.conversationId ?? null;
  const composerNotice = transcribingHere ? (
    <ChatComposerNotice label="Transcribing…" />
  ) : pending ? (
    <ChatComposerNotice
      label={workingElsewhereLabel(pendingTitle)}
      onPress={workingId ? () => pushConversation(workingId) : undefined}
    />
  ) : null;
  const gateOptions = chatTabGateOptions(activeMode);
  // Leaving Home, or asking something else, while a question is being spoken would drop it.
  const runIfVoiceIdle = (action: () => void): void => {
    if (voiceRef.current.state === 'idle') action();
  };

  const ask = (question: string, clearDraft: boolean): void => {
    if (!question.trim() || busy) return;
    gate((allowCloudFallback) => {
      const result = useChatStore
        .getState()
        .send(question, { conversationId: null, allowCloudFallback });
      if (!result) return;
      if (clearDraft) setDraft('');
      pushConversation(result.conversationId);
    }, gateOptions);
  };

  const headerButtons = (
    <View className="flex-row gap-3">
      <GlassIconButton
        accessibilityLabel="All chats"
        onPress={() => runIfVoiceIdle(() => router.push(CHAT_HISTORY_ROUTE))}
      >
        <SystemIcon name="clock.arrow.circlepath" mdName="History" size={18} color="brand" />
      </GlassIconButton>
      {chatEnabled ? (
        <GlassIconButton
          accessibilityLabel="New chat"
          onPress={() => runIfVoiceIdle(() => pushConversation(NEW_CHAT_ID))}
        >
          <SystemIcon name="square.and.pencil" mdName="SquarePen" size={18} color="brand" />
        </GlassIconButton>
      ) : null}
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
                disabled={busy || voice.state !== 'idle'}
                onPress={(suggestion) => runIfVoiceIdle(() => ask(suggestion.prompt, false))}
              />
            </View>

            <ChatRecentList
              conversations={conversations.slice(0, RECENT_CONVERSATION_COUNT)}
              onOpen={(conversationId) => runIfVoiceIdle(() => pushConversation(conversationId))}
              onSeeAll={() => runIfVoiceIdle(() => router.push(CHAT_HISTORY_ROUTE))}
            />
          </ScrollView>

          <ChatInputBar
            voice={voice}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask anything"
            busy={busy}
            canStop={transcribingHere}
            disabled={false}
            onSend={() => ask(draft, true)}
            onMicPress={(startVoice) => {
              if (!busy) gate(startVoice, gateOptions);
            }}
            onCancelTurn={() => useChatStore.getState().cancel()}
            restingBottomPadding={TAB_BAR_CLEARANCE}
            notice={composerNotice}
          />
        </>
      ) : (
        <ChatTurnedOff onOpenSettings={() => router.push(CHAT_SETTINGS_ROUTE)} />
      )}
    </View>
  );
}
