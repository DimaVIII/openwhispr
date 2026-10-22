import { Share } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type { ChatMessage } from '@/lib/chat/types';
import { ChatAssistantMessage } from '../ChatAssistantMessage';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  Easing: { inOut: jest.fn(), ease: jest.fn(), linear: jest.fn() },
  cancelAnimation: jest.fn(),
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (initial: number) => ({ value: initial }),
  withRepeat: jest.fn(),
  withTiming: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/utils', () => ({ safeHaptics: jest.fn() }));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/notes/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => {
    const { Text } = require('react-native');
    return <Text>{content}</Text>;
  },
}));

const message: ChatMessage = {
  id: 'm1',
  conversationId: 'c1',
  role: 'assistant',
  text: 'You agreed on $40 per seat.',
  steps: [{ id: 'search', status: 'done', label: 'Searched your notes' }],
  sources: [{ noteId: 7, title: 'Pricing call' }],
  createdAt: 0,
};

describe('ChatAssistantMessage', () => {
  it('opens a source note', () => {
    const onOpenNote = jest.fn();
    const { getByText, getByRole } = render(
      <ChatAssistantMessage message={message} onOpenNote={onOpenNote} />,
    );
    expect(getByRole('link')).toBeTruthy();
    fireEvent.press(getByText('Pricing call'));
    expect(onOpenNote).toHaveBeenCalledWith(7);
  });

  it('copies the answer', () => {
    const { getByLabelText } = render(
      <ChatAssistantMessage message={message} onOpenNote={jest.fn()} />,
    );
    fireEvent.press(getByLabelText('Copy answer'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('You agreed on $40 per seat.');
  });

  it('shares the answer', () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { getByLabelText } = render(
      <ChatAssistantMessage message={message} onOpenNote={jest.fn()} />,
    );
    fireEvent.press(getByLabelText('Share answer'));
    expect(share).toHaveBeenCalledWith({ message: 'You agreed on $40 per seat.' });
  });
});
