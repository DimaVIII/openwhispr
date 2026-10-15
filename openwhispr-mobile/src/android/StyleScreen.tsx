import { router } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useConfigStore } from '@/store/useConfigStore';
import { Page, Card, Button, Row, styles } from './ui';
export default function StyleScreen() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const context = config?.androidStyleContext ?? 'personal';
  const selectedTone = config?.androidStyleTones?.[context] ?? config?.keyboardTone ?? 'default';
  return (
    <Page title={t('style')}>
      <Text style={styles.title}>{t('styleTitle')}</Text>
      <Text style={styles.body}>{t('styleBody')}</Text>
      <Text style={styles.heading}>{t('context')}</Text>
      <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'flex-start', gap: 8 }]}>
        {(['personal', 'work', 'email', 'notes'] as const).map((item) => (
          <Button
            key={item}
            secondary={context !== item}
            label={t(item)}
            onPress={() => {
              void useConfigStore.getState().updateConfig({ androidStyleContext: item });
            }}
          />
        ))}
      </View>
      <Card>
        {(['default', 'formal', 'casual', 'very_casual', 'excited'] as const).map((tone) => (
          <Button
            key={tone}
            secondary={selectedTone !== tone}
            label={t(tone)}
            onPress={() => {
              void useConfigStore.getState().updateConfig({
                androidStyleTones: { ...config?.androidStyleTones, [context]: tone },
              });
            }}
          />
        ))}
      </Card>
      <Card>
        <Row title={t('prompt')} onPress={() => router.push('/(account)/cleanup-prompt')} />
      </Card>
    </Page>
  );
}
