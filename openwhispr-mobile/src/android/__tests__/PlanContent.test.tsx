import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { useUsageStore } from '@/store/useUsageStore';
import { restoreAndroidPurchases, useAndroidBillingStatus } from '../billing';
import { PlanContent } from '../PlanContent';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/lib/superwall', () => ({ SUPERWALL_PLACEMENTS: { accountBillingOpen: 'billing' } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: require('zustand').create(() => ({ user: { id: 'a', isAnonymous: false } })),
}));
jest.mock('@/store/useUsageStore', () => ({
  useUsageStore: require('zustand').create(() => ({
    usage: null,
    load: jest.fn(async () => undefined),
  })),
}));
jest.mock('@/hooks/useSuperwallGate', () => ({
  useSuperwallGate: () => ({ register: jest.fn() }),
}));
jest.mock('@/data/remote/billingApi', () => ({ createStripeBillingPortalSession: jest.fn() }));
jest.mock('../billing', () => ({
  useAndroidBillingStatus: require('zustand').create(() => ({ accounts: {} })),
  restoreAndroidPurchases: jest.fn(async () => 'payment-pending'),
  refreshAndroidBillingAccess: jest.fn(),
}));
jest.mock('../ui', () => {
  const { Pressable, Text } = require('react-native');
  const Button = ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) =>
    require('react').createElement(
      Pressable,
      { onPress, disabled, accessibilityRole: 'button', accessibilityLabel: label },
      require('react').createElement(Text, null, label),
    );
  return {
    Card: ({ children }: { children: React.ReactNode }) => children,
    Button,
    Row: ({ title, onPress }: { title: string; onPress: () => void }) =>
      require('react').createElement(Button, { label: title, onPress }),
    styles: {},
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  useUsageStore.setState({
    usage: {
      billingUserId: 'billing-a',
      isSubscribed: false,
      wordsRemaining: 2000,
      limit: 2000,
      wordsUsed: 0,
      plan: 'free',
      status: 'active',
      isTrial: false,
      trialDaysLeft: null,
      currentPeriodEnd: null,
      billingInterval: null,
      resetAt: '2026-11-01T00:00:00Z',
      entitlementSources: { provider: false, personal: false, workspaceIds: [] },
    },
  });
  useAndroidBillingStatus.setState({ accounts: { 'billing-a': 'payment-pending' } });
});
it('offers Play and help for an unresolved payment without launching another checkout', async () => {
  render(<PlanContent />);
  expect(screen.queryByRole('button', { name: 'upgrade' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'managePlay' }));
  await waitFor(() =>
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://play.google.com/store/account/subscriptions',
    ),
  );
  fireEvent.press(screen.getByRole('button', { name: 'support' }));
  expect(router.push).toHaveBeenCalledWith('/(account)/help');
});
it('explains the unresolved payment after an empty restore', async () => {
  render(<PlanContent />);
  fireEvent.press(screen.getByRole('button', { name: 'restorePurchases' }));
  await waitFor(() => expect(restoreAndroidPurchases).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith('restorePurchases', 'billingPaymentPending'),
  );
});
it('does not show Play management for a free account without a pending payment', () => {
  useAndroidBillingStatus.setState({ accounts: {} });
  render(<PlanContent />);
  expect(screen.queryByRole('button', { name: 'managePlay' })).toBeNull();
  expect(screen.getByRole('button', { name: 'upgrade' })).toBeTruthy();
});
