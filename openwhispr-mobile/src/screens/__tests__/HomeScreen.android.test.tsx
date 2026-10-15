import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
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

it('counts completed and legacy dictations while retaining failed audio for retry', () => {
  render(<AndroidHome />);
  expect(screen.getByText('2')).toBeTruthy();
  expect(screen.getByText('5')).toBeTruthy();
  expect(screen.getByText('Unreadable audio')).toBeTruthy();
  expect(screen.getByText('retry')).toBeTruthy();
});
