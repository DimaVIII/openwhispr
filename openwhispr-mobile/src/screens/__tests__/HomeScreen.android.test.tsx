import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/android/insights', () => ({
  refreshInsights: jest.fn(),
  useInsights: () => ({
    scope: 'device',
    ledger: { events: [{ word_count: 42 }], acknowledged: [] },
    status: 'idle',
  }),
}));
jest.mock('@/store/useConfigStore', () => ({ useConfigStore: () => false }));
jest.mock('@/android/bubbleResult', () => ({ useBubbleResult: () => ({}) }));
jest.mock('@/android/Practice', () => ({ Practice: () => null }));
jest.mock('@/android/pipeline', () => ({ applyHistoryRetention: jest.fn(async () => {}) }));
jest.mock('@/hooks/useAppInit', () => ({ useAppInit: jest.fn() }));
jest.mock('@/hooks/useFileUpload', () => ({ useFileUpload: () => ({}) }));
jest.mock('@/hooks/useSuperwallGate', () => ({ useSuperwallGate: () => ({}) }));
jest.mock('@/lib/inferenceRouting', () => ({ getTranscriptionProvider: () => 'local' }));
jest.mock('@/lib/accountAccess', () => ({}));
jest.mock('@/lib/superwall', () => ({}));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: () => null }));
jest.mock('@/store/useUsageStore', () => ({ useUsageStore: () => null }));
jest.mock('@/store/useTranscriptStore', () => ({
  useTranscriptStore: () => [
    { id: 'done', text: 'Hello there.', status: 'completed', createdAt: 1, provider: 'local' },
    { id: 'legacy', text: 'One more dictation.', createdAt: 2, provider: 'local' },
    {
      id: 'failed',
      text: 'Unfinished raw audio',
      status: 'failed',
      createdAt: 3,
      provider: 'local',
      errorMessage: 'Unreadable audio',
      audioUrl: 'file:///invalid.wav',
    },
  ],
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/android/ui', () => {
  const { View, Text } = require('react-native');
  return {
    Page: View,
    Card: View,
    Row: () => null,
    styles: {},
    Button: ({ label }: { label: string }) => <Text>{label}</Text>,
  };
});

import AndroidHome from '../HomeScreen.android';

it('uses durable dictation statistics rather than retained transcripts and keeps failed audio retryable', () => {
  render(<AndroidHome />);
  expect(screen.getByText('1')).toBeTruthy();
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.getByText('Unreadable audio')).toBeTruthy();
  expect(screen.getByText('retry')).toBeTruthy();
});
