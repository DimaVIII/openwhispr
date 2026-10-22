import { Stack } from 'expo-router';
import { customHeaderStackOptions, glassStackOptions } from '@/config/navigation';

export default function ChatLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={customHeaderStackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="history" />
      <Stack.Screen name="note/[id]" />
      <Stack.Screen
        name="note/actions"
        options={{ ...glassStackOptions, title: 'Actions', headerLargeTitle: false }}
      />
      <Stack.Screen
        name="note/voice-enrollment"
        options={{ ...glassStackOptions, title: 'Voice Sample', headerLargeTitle: false }}
      />
    </Stack>
  );
}
