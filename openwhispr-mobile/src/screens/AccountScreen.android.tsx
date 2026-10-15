import { Alert, Linking, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/useAuthStore';
import { useConfigStore } from '@/store/useConfigStore';
import { Page, Card, Row, styles, palette } from '@/android/ui';
import { applyHistoryRetention } from '@/android/pipeline';
export default function AndroidAccount() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const config = useConfigStore((s) => s.config);
  return (
    <Page title={t('account')} back>
      <Text style={styles.title}>{user?.name || t('signedOut')}</Text>
      <Card>
        {!user || user.isAnonymous ? (
          <Row title={t('signIn')} onPress={() => router.push('/auth')} />
        ) : (
          <Row title={user.email} onPress={() => router.push('/(account)/profile')} />
        )}
        <Row title={t('upgrade')} onPress={() => router.push('/android-pro')} />
        <Row title={t('referrals')} onPress={() => router.push('/(tabs)/(referral)')} />
      </Card>
      <Text style={styles.heading}>{t('preferences')}</Text>
      <Card>
        <Row title={t('models')} onPress={() => router.push('/android-models')} />
        <Row title={t('permissions')} onPress={() => router.push('/android-permissions')} />
        <Row
          title={t('language')}
          onPress={() => router.push('/(account)/transcription-language')}
        />
        <Row title={t('preferences')} onPress={() => router.push('/(account)/preferences')} />
        <Row title={t('privacyData')} onPress={() => router.push('/(account)/privacy')} />
      </Card>
      <Card>
        <Text style={styles.heading}>{t('retention')}</Text>
        <Text style={styles.caption}>{t('retentionHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([-1, 30, 7, 0] as const).map((days, index) => (
            <Pressable
              key={days}
              accessibilityRole="button"
              onPress={() => {
                Alert.alert(t('retention'), t('retentionHint'), [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('save'),
                    onPress: () => {
                      useConfigStore
                        .getState()
                        .updateConfig({ androidHistoryDays: days })
                        .then(applyHistoryRetention);
                    },
                  },
                ]);
              }}
              style={[
                styles.pill,
                (config?.androidHistoryDays ?? -1) === days && { backgroundColor: palette.soft },
              ]}
            >
              <Text>{t(['forever', 'thirtyDays', 'sevenDays', 'never'][index])}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card>
        <Row
          title={t('support')}
          onPress={() => {
            Linking.openURL('mailto:support@openwhispr.com?subject=Android%20support');
          }}
        />
        <Row
          title={t('feedback')}
          onPress={() => {
            Linking.openURL('https://github.com/OpenWhispr/openwhispr/issues');
          }}
        />
        <Row
          title={t('terms')}
          onPress={() => {
            Linking.openURL('https://openwhispr.com/terms');
          }}
        />
        <Row
          title={t('privacy')}
          onPress={() => {
            Linking.openURL('https://openwhispr.com/privacy');
          }}
        />
        <Row title={t('licenses')} onPress={() => router.push('/(account)/licenses')} />
        <Row title={t('review')} onPress={() => Alert.alert(t('review'), t('reviewUnavailable'))} />
      </Card>
      <Text style={styles.caption}>
        {t('version')} · {Constants.expoConfig?.version}
      </Text>
    </Page>
  );
}
