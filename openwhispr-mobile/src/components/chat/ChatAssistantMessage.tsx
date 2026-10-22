import { Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { MarkdownRenderer } from '@/components/notes/MarkdownRenderer';
import { CHAT_COLORS } from '@/config/colors';
import { safeHaptics } from '@/lib/utils';
import type { ChatMessage } from '@/lib/chat/types';
import { ChatSteps } from './ChatSteps';

interface ChatAssistantMessageProps {
  message: ChatMessage;
  onOpenNote: (noteId: number) => void;
}

export function ChatAssistantMessage({
  message,
  onOpenNote,
}: ChatAssistantMessageProps): React.JSX.Element {
  const copy = async (): Promise<void> => {
    safeHaptics('light');
    try {
      await Clipboard.setStringAsync(message.text);
    } catch {
      // The clipboard can refuse a write; there is nothing useful to tell the user.
    }
  };

  const share = async (): Promise<void> => {
    try {
      await Share.share({ message: message.text });
    } catch {
      // Dismissing or failing the share sheet needs no handling here.
    }
  };

  return (
    <View className="gap-1 self-stretch">
      {/* A message saved without steps never searched, so claiming it did would mislead. */}
      {message.steps.length > 0 ? (
        <ChatSteps steps={message.steps} variant="done" sourceCount={message.sources.length} />
      ) : null}
      <MarkdownRenderer content={message.text} selectable />
      {message.sources.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap gap-2">
          {message.sources.map((source) => (
            <Pressable
              key={source.noteId}
              accessibilityRole="link"
              accessibilityLabel={source.title}
              onPress={() => onOpenNote(source.noteId)}
              className="min-h-[44px] max-w-full flex-row items-center gap-1.5 rounded-[10px] bg-secondarySystemGroupedBackground px-3 active:opacity-70"
              style={styles.chip}
            >
              <SystemIcon name="doc.text" mdName="FileText" size={14} color="secondaryLabel" />
              <Text className="shrink text-[14px] text-label" numberOfLines={1}>
                {source.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="mt-1 flex-row">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy answer"
          onPress={copy}
          className="h-11 w-11 items-center justify-center active:opacity-60"
        >
          <SystemIcon name="doc.on.doc" mdName="Copy" size={18} color="secondaryLabel" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share answer"
          onPress={share}
          className="h-11 w-11 items-center justify-center active:opacity-60"
        >
          <SystemIcon name="square.and.arrow.up" mdName="Share" size={18} color="secondaryLabel" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: StyleSheet.hairlineWidth, borderColor: CHAT_COLORS.hairline },
});
