import { useBubbleResult } from '@/android/bubbleResult';
import { useEffect, useRef, useState } from 'react';
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
import { useFileUpload } from '@/hooks/useFileUpload';
import { getTranscriptionProvider } from '@/lib/inferenceRouting';
import { accountRequiredForCloud, showAccountRequiredAlert } from '@/lib/accountAccess';
import { useAuthStore } from '@/store/useAuthStore';
import { useUsageStore } from '@/store/useUsageStore';
import { useSuperwallGate } from '@/hooks/useSuperwallGate';
import { buildUsageGateParams, SUPERWALL_PLACEMENTS } from '@/lib/superwall';

export default function AndroidHome() {
  useAppInit();
  const { t } = useTranslation();
  const [practice, setPractice] = useState(false);
  const pending = useBubbleResult();
  const history = useTranscriptStore((s) => s.transcripts);
  const user = useAuthStore((s) => s.user);
  const usage = useUsageStore((s) => s.usage);
  const { register } = useSuperwallGate();
  const action = useRef(false);
  const [working, setWorking] = useState(false);
  const { isProcessing, currentText, stage, cancel, pickAndTranscribeFile } = useFileUpload({
    onError: (error) => Alert.alert(t('errorTitle'), error.message),
  });
  const upload = async () => {
    if (action.current) return;
    const provider = getTranscriptionProvider('upload');
    if (provider === 'cloud' && accountRequiredForCloud(user)) {
      showAccountRequiredAlert(t('upload'));
      return;
    }
    const begin = async () => {
      if (action.current) return;
      action.current = true;
      setWorking(true);
      try {
        await pickAndTranscribeFile();
      } catch {
        // The upload hook displayed the error and retained retryable audio.
      } finally {
        await applyHistoryRetention().catch(() => undefined);
        action.current = false;
        setWorking(false);
      }
    };
    if (provider === 'cloud' && user) {
      try {
        await register({
          placement: SUPERWALL_PLACEMENTS.audioUploadStart,
          params: usage ? buildUsageGateParams(usage) : undefined,
          requiresAccount: false,
          feature: () => {
            void begin();
          },
        });
      } catch (error) {
        Alert.alert(t('errorTitle'), (error as Error).message);
      }
    } else await begin();
  };
  const retry = async (id: string) => {
    if (action.current) return;
    action.current = true;
    setWorking(true);
    try {
      await useTranscriptStore.getState().retryTranscript(id);
    } catch (error) {
      Alert.alert(t('errorTitle'), (error as Error).message);
    } finally {
      await applyHistoryRetention().catch(() => undefined);
      action.current = false;
      setWorking(false);
    }
  };
  useEffect(() => {
    applyHistoryRetention().catch(() => undefined);
  }, []);
  const completed = history.filter((item) => (item.status ?? 'completed') === 'completed');
  const words = completed.reduce(
    (total, item) => total + item.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return (
    <Page
      title="OpenWhispr"
      footer={<Button disabled={working} label={t('dictate')} onPress={() => setPractice(true)} />}
    >
      <Text style={styles.title}>{t('greeting')}</Text>
      <Button
        secondary
        busy={working}
        label={t('upload')}
        onPress={() => {
          void upload();
        }}
      />
      {isProcessing && (
        <Card>
          <Text>{t(stage === 'cleaning' ? 'cleanup' : 'processing')}</Text>
          {currentText ? <Text>{currentText}</Text> : null}
          <Button secondary label={t('cancel')} onPress={cancel} />
        </Card>
      )}
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
          <Text style={styles.heading}>{completed.length}</Text>
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
            <Text style={{ fontSize: 17, lineHeight: 25 }}>
              {item.status === 'failed' ? item.errorMessage : item.text}
            </Text>
            {item.cleanupWarning ? (
              <Text accessibilityRole="alert">{item.cleanupWarning}</Text>
            ) : null}
            <View style={styles.row}>
              <Text style={styles.caption}>
                {new Date(item.createdAt).toLocaleDateString()} ·{' '}
                {t(
                  item.provider === 'local' ? 'local' : item.provider === 'byok' ? 'byok' : 'cloud',
                )}
              </Text>
              {item.status === 'failed' ? (
                <Button
                  secondary
                  disabled={working || !item.audioUrl}
                  label={t('retry')}
                  onPress={() => {
                    void retry(item.id);
                  }}
                />
              ) : (
                <Button
                  secondary
                  label={t('copy')}
                  onPress={() => {
                    Clipboard.setStringAsync(item.text).then(() => Alert.alert(t('copied')));
                  }}
                />
              )}
            </View>
          </Card>
        ))}
      <Modal visible={practice} animationType="slide" onRequestClose={() => setPractice(false)}>
        <SafeAreaView style={styles.page}>
          <Page
            title={t('dictate')}
            showAccount={false}
            footer={<Button secondary label={t('close')} onPress={() => setPractice(false)} />}
          >
            <Practice />
          </Page>
        </SafeAreaView>
      </Modal>
    </Page>
  );
}
