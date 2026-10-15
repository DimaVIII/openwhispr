import { Alert, Switch, View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/useAuthStore';
import { useConfigStore } from '@/store/useConfigStore';
import { useSyncStore } from '@/sync/useSyncStore';
import { requestSync } from '@/sync/syncEngine';
import { requiresRealAccount } from '@/lib/accountAccess';
import { setInsightsSyncConsent } from '@/android/insights';
import { applyHistoryRetention } from '@/android/pipeline';
import { Page, Card, Button, styles, palette } from '@/android/ui';

export default function PrivacyDataScreen() {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const signedIn = useAuthStore((state) => !requiresRealAccount(state.user));
  const sync = useSyncStore();
  const update = async (change: {
    cloudBackupEnabled?: boolean;
    usageAnalyticsEnabled?: boolean;
    insightsSyncEnabled?: boolean;
  }) => {
    try {
      if (change.insightsSyncEnabled !== undefined)
        await setInsightsSyncConsent(change.insightsSyncEnabled);
      else {
        await useConfigStore.getState().updateConfig(change);
        if (useConfigStore.getState().error) throw new Error(useConfigStore.getState().error!);
      }
      if (change.cloudBackupEnabled) await requestSync('manual');
    } catch (error) {
      Alert.alert(t('errorTitle'), (error as Error).message);
    }
  };
  return (
    <Page title={t('privacyData')} back>
      <Text style={styles.body}>{t('privateBody')}</Text>
      <Card>
        <View style={styles.row}>
          <Text style={{ flex: 1 }}>{t('cloudBackup')}</Text>
          <Switch
            accessibilityLabel={t('cloudBackup')}
            value={config?.cloudBackupEnabled ?? false}
            disabled={!signedIn || sync.policyBlocked || sync.subscriptionRequired}
            onValueChange={(value) => {
              void update({ cloudBackupEnabled: value });
            }}
          />
        </View>
        <Text style={styles.body}>
          {t(
            !signedIn
              ? 'syncSignIn'
              : sync.policyBlocked
                ? 'syncPolicy'
                : sync.subscriptionRequired
                  ? 'syncPro'
                  : 'syncExplanation',
          )}
        </Text>
        {signedIn && <Text style={styles.caption}>{t('syncStatus', { status: sync.status })}</Text>}
        {signedIn && config?.cloudBackupEnabled && (
          <Button
            secondary
            label={t('syncNow')}
            onPress={() => {
              void requestSync('manual');
            }}
          />
        )}
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={{ flex: 1 }}>{t('insightsSync')}</Text>
          <Switch
            accessibilityLabel={t('insightsSync')}
            value={config?.insightsSyncEnabled ?? false}
            disabled={!signedIn || config?.androidHistoryDays === 0 || sync.policyBlocked}
            onValueChange={(value) => {
              void update({ insightsSyncEnabled: value });
            }}
          />
        </View>
        <Text style={styles.body}>{t('insightsSyncBody')}</Text>
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={{ flex: 1 }}>{t('analytics')}</Text>
          <Switch
            accessibilityLabel={t('analytics')}
            value={config?.usageAnalyticsEnabled ?? true}
            onValueChange={(value) => {
              void update({ usageAnalyticsEnabled: value });
            }}
          />
        </View>
        <Text style={styles.body}>{t('analyticsBody')}</Text>
      </Card>
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('retention')}
        </Text>
        <Text style={styles.caption}>{t('retentionHint')}</Text>
        {([-1, 30, 7, 0] as const).map((days, index) => (
          <Pressable
            key={days}
            accessibilityRole="radio"
            accessibilityState={{ checked: (config?.androidHistoryDays ?? -1) === days }}
            style={[styles.row, { minHeight: 48 }]}
            onPress={() =>
              Alert.alert(t('retention'), t(days < 0 ? 'retentionHint' : 'retentionConfirm'), [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('save'),
                  onPress: () => {
                    void useConfigStore
                      .getState()
                      .updateConfig({ androidHistoryDays: days })
                      .then(applyHistoryRetention)
                      .catch((error: Error) => Alert.alert(t('errorTitle'), error.message));
                  },
                },
              ])
            }
          >
            <Text style={{ color: palette.ink }}>
              {t(['forever', 'thirtyDays', 'sevenDays', 'never'][index])}
            </Text>
            {(config?.androidHistoryDays ?? -1) === days && (
              <Text style={{ color: palette.blue }}>✓</Text>
            )}
          </Pressable>
        ))}
      </Card>
      <Card>
        <Text style={styles.heading}>{t('selectionPrivacy')}</Text>
        <Text style={styles.body}>{t('selectionPrivacyBody')}</Text>
      </Card>
    </Page>
  );
}
