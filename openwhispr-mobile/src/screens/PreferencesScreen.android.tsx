import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useConfigStore } from '@/store/useConfigStore';
import { AndroidDictation } from '../../modules/android-dictation/src';
import { Page, Card, Row, styles } from '@/android/ui';

export default function PreferencesScreen() {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const update = useConfigStore((state) => state.updateConfig);
  return (
    <Page title={t('preferences')} back>
      <Card>
        <Row
          title={t('language')}
          onPress={() => router.push('/(account)/transcription-language')}
        />
        <Row title={t('models')} onPress={() => router.push('/android-models')} />
        <Row title={t('style')} onPress={() => router.push('/(tabs)/(style)')} />
        <Row title={t('prompt')} onPress={() => router.push('/(account)/cleanup-prompt')} />
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={{ flex: 1 }}>{t('cleanup')}</Text>
          <Switch
            accessibilityLabel={t('cleanup')}
            value={config?.cleanupEnabled ?? true}
            onValueChange={(value) => {
              void update({ cleanupEnabled: value });
            }}
          />
        </View>
        <Text style={styles.caption}>{t('cleanupPreference')}</Text>
      </Card>
      <Card>
        <Row title={t('permissions')} onPress={() => router.push('/android-permissions')} />
        <Row title={t('notifications')} onPress={() => AndroidDictation!.openSettings('app')} />
      </Card>
    </Page>
  );
}
