import { Stack } from 'expo-router';
import { customHeaderStackOptions } from '@/config/navigation';

export default function ChatLayout() {
  return (
    <Stack screenOptions={customHeaderStackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
