import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { useConfigStore } from '@/store/useConfigStore';
import { promptLocalReasoningFallback } from '../localReasoningFallback';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/localReasoning', () => ({
  clearLocalReasoningReadinessCache: jest.fn(),
  getLocalReasoningUnavailableMessage: () => 'Download a local text model.',
}));
const mockUpdateConfig = jest.fn();
jest.mock('@/store/useConfigStore', () => ({
  useConfigStore: { getState: () => ({ updateConfig: mockUpdateConfig }) },
}));

it('offers Android models without enabling an Apple setting or silently using cloud', () => {
  const original = Platform.OS;
  Platform.OS = 'android';
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const enable = jest.fn();
  const cloud = jest.fn();
  try {
    promptLocalReasoningFallback({
      readiness: { status: 'disabled' },
      signedIn: true,
      onEnableLocal: enable,
      onUseCloudOnce: cloud,
    });
    const buttons = alert.mock.calls[0][2]!;
    expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Models', 'Use Cloud Once']);
    buttons.find((button) => button.text === 'Models')!.onPress!();
    expect(router.push).toHaveBeenCalledWith('/(account)/ai-models');
    expect(useConfigStore.getState().updateConfig).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
  } finally {
    Platform.OS = original;
    alert.mockRestore();
  }
});
