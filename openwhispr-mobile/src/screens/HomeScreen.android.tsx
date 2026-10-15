import { useBubbleResult } from '@/android/bubbleResult';
import { useEffect, useState } from 'react';
import { View, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useTranscriptStore } from '@/store/useTranscriptStore';
import { useAppInit } from '@/hooks/useAppInit';
import { Page, Card, Button, Row, styles } from '@/android/ui';
import { Practice } from '@/android/Practice';
import { applyHistoryRetention } from '@/android/pipeline';

export default function AndroidHome() {
  useAppInit();
  const { t } = useTranslation();
  const [practice, setPractice] = useState(false);
  const pending = useBubbleResult();
  const history = useTranscriptStore((s) => s.transcripts);
  useEffect(() => {
    applyHistoryRetention().catch(() => undefined);
  }, []);
  const words = history.reduce(
    (total, item) => total + item.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return (
    <Page
      title="OpenWhispr"
      footer={<Button label={t('dictate')} onPress={() => setPractice(true)} />}
    >
      <Text style={styles.title}>{t('greeting')}</Text>
      {pending.text || pending.error ? (
        <Card>
          {pending.error ? <Text accessibilityRole="alert">{pending.error}</Text> : null}
          {pending.text ? (
            <>
              <Text>{pending.text}</Text>
              <Button
                label={t('copy')}
                onPress={() => {
                  Clipboard.setStringAsync(pending.text).then(() => Alert.alert(t('copied')));
                }}
              />
            </>
          ) : null}
          <Button secondary label={t('close')} onPress={pending.dismiss} />
        </Card>
      ) : null}
      <View style={styles.row}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.heading}>{words}</Text>
          <Text style={styles.caption}>{t('words')}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.heading}>{history.length}</Text>
          <Text style={styles.caption}>{t('recordings')}</Text>
        </Card>
      </View>
      <Card>
        <Row title={t('models')} onPress={() => router.push('/android-models')} />
        <Row title={t('permissions')} onPress={() => router.push('/android-permissions')} />
        <Row title={t('assistant')} onPress={() => router.push('/android-assistant')} />
        <Row title={t('referrals')} onPress={() => router.push('/(tabs)/(referral)')} />
      </Card>
      <Text style={styles.heading}>{t('recent')}</Text>
      {!history.length && (
        <Card>
          <Text style={styles.heading}>{t('emptyHistory')}</Text>
          <Text style={styles.body}>{t('emptyHistoryBody')}</Text>
        </Card>
      )}
      {[...history]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30)
        .map((item) => (
          <Card key={item.id}>
            <Text style={{ fontSize: 17, lineHeight: 25 }}>{item.text}</Text>
            <View style={styles.row}>
              <Text style={styles.caption}>
                {new Date(item.createdAt).toLocaleDateString()} ·{' '}
                {t(
                  item.provider === 'local' ? 'local' : item.provider === 'byok' ? 'byok' : 'cloud',
                )}
              </Text>
              <Button
                secondary
                label={t('copy')}
                onPress={() => {
                  Clipboard.setStringAsync(item.text).then(() => Alert.alert(t('copied')));
                }}
              />
            </View>
          </Card>
        ))}
      <Modal visible={practice} animationType="slide" onRequestClose={() => setPractice(false)}>
        <SafeAreaView style={styles.page}>
          <Page
            title={t('dictate')}
            footer={<Button secondary label={t('close')} onPress={() => setPractice(false)} />}
          >
            <Practice />
          </Page>
        </SafeAreaView>
      </Modal>
    </Page>
  );
}
