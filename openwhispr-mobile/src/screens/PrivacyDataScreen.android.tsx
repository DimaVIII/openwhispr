import { Alert, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/useAuthStore';
import { useConfigStore } from '@/store/useConfigStore';
import { useSyncStore } from '@/sync/useSyncStore';
import { requestSync } from '@/sync/syncEngine';
import { requiresRealAccount } from '@/lib/accountAccess';
import { Page, Card, Button, styles } from '@/android/ui';

export default function PrivacyDataScreen() {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const signedIn = useAuthStore((state) => !requiresRealAccount(state.user));
  const sync = useSyncStore();
  const update = async (change: {
    cloudBackupEnabled?: boolean;
    usageAnalyticsEnabled?: boolean;
  }) => {
    try {
      await useConfigStore.getState().updateConfig(change);
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
        <Text style={styles.heading}>{t('selectionPrivacy')}</Text>
        <Text style={styles.body}>{t('selectionPrivacyBody')}</Text>
      </Card>
    </Page>
  );
}
