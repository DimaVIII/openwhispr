import { useEffect, useState } from 'react';
import { View, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { useConfigStore } from '@/store/useConfigStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';
import { SettingsSwitch } from '@/components/ui/SettingsSwitch';
import { setPrivateMode } from '@/lib/workflowModeSwitch';
import {
  ANDROID_MODELS,
  modelReady,
  downloadAndroidModel,
  cancelAndroidDownload,
  removeAndroidModel,
  useModelDownloads,
  type AndroidModelId,
} from './models';
import { Button, Card, Page, Row, styles } from './ui';
export function ModelsContent({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const privateMode = useProcessingModeStore((s) => s.activeMode === 'private');
  const [requestedPrivateMode, setRequestedPrivateMode] = useState<boolean | null>(null);
  const [ready, setReady] = useState<Partial<Record<AndroidModelId, boolean>>>({});
  const [removing, setRemoving] = useState(false);
  const progress = useModelDownloads((state) => state.progress);
  const activeDownloads = Object.keys(progress).sort().join(',');
  const togglePrivateMode = async (enabled: boolean) => {
    if (requestedPrivateMode !== null) return;
    setRequestedPrivateMode(enabled);
    try {
      await setPrivateMode(enabled);
    } catch (error) {
      Alert.alert(t('errorTitle'), (error as Error).message);
    } finally {
      setRequestedPrivateMode(null);
    }
  };
  const refresh = async () => {
    const rows = await Promise.all(
      (Object.keys(ANDROID_MODELS) as AndroidModelId[]).map(async (id) => [
        id,
        await modelReady(id),
      ]),
    );
    setReady(Object.fromEntries(rows));
  };
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [activeDownloads]);
  const download = async (id: AndroidModelId) => {
    try {
      await downloadAndroidModel(id);
      await refresh();
    } catch (error) {
      Alert.alert(t('errorTitle'), (error as Error).message);
    }
  };
  const remove = async (id: AndroidModelId) => {
    setRemoving(true);
    try {
      await removeAndroidModel(id);
      await refresh();
    } catch (error) {
      Alert.alert(t('errorTitle'), (error as Error).message);
    } finally {
      setRemoving(false);
    }
  };
  return (
    <>
      <Text style={styles.body}>{t('modelIntro')}</Text>
      <Card>
        <View style={styles.row}>
          <Text style={[styles.heading, { flex: 1 }]}>{t('privateMode')}</Text>
          <SettingsSwitch
            accessibilityLabel={t('privateMode')}
            value={requestedPrivateMode ?? privateMode}
            disabled={requestedPrivateMode !== null}
            onValueChange={(enabled) => {
              void togglePrivateMode(enabled);
            }}
          />
        </View>
        <Text style={styles.body}>{t('privateModeDescription')}</Text>
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={[styles.heading, { flex: 1 }]}>{t('cleanup')}</Text>
          <SettingsSwitch
            accessibilityLabel={t('cleanup')}
            value={config?.cleanupEnabled !== false}
            onValueChange={(cleanupEnabled) => {
              useConfigStore
                .getState()
                .updateConfig({ cleanupEnabled })
                .catch((error) => Alert.alert(t('errorTitle'), error.message));
            }}
          />
        </View>
      </Card>
      <Row
        title={t('workflow')}
        onPress={() => {
          onNavigate?.();
          router.push({ pathname: '/(account)/ai-workflow', params: { scope: 'dictation' } });
        }}
      />
      {(['speech', 'text'] as const).map((kind) => (
        <View key={kind} style={{ gap: 12 }}>
          <Text style={styles.heading}>{t(kind === 'speech' ? 'speechModels' : 'textModels')}</Text>
          {(
            Object.entries(ANDROID_MODELS) as [
              AndroidModelId,
              (typeof ANDROID_MODELS)[AndroidModelId],
            ][]
          )
            .filter(([, model]) => model.kind === kind)
            .map(([id, model]) => {
              const chosen =
                kind === 'speech'
                  ? id === 'parakeet-v3'
                  : (config?.androidTextModel ?? 'qwen-balanced') === id;
              return (
                <Card key={id}>
                  <Text style={{ fontSize: 19, fontWeight: '600' }}>{model.title}</Text>
                  <Text style={styles.caption}>
                    {Math.round(model.bytes / 1000000)} MB ·{' '}
                    {ready[id]
                      ? t('downloaded')
                      : t(
                          id === 'qwen-small'
                            ? 'modelLight'
                            : id === 'parakeet-v3'
                              ? 'modelParakeet'
                              : 'modelBalanced',
                        )}
                  </Text>
                  {progress[id] !== undefined ? (
                    <>
                      <Text>{Math.round(progress[id]! * 100)}%</Text>
                      <Button
                        secondary
                        label={t('cancel')}
                        onPress={() => {
                          cancelAndroidDownload(id).catch(() => undefined);
                        }}
                      />
                    </>
                  ) : ready[id] ? (
                    <>
                      <Button
                        secondary
                        disabled={chosen || removing}
                        label={t(chosen ? 'selected' : 'choose')}
                        onPress={() => {
                          useConfigStore
                            .getState()
                            .updateConfig(
                              kind === 'speech'
                                ? { androidSpeechModel: id as 'parakeet-v3' }
                                : { androidTextModel: id as 'qwen-small' | 'qwen-balanced' },
                            );
                        }}
                      />
                      <Button
                        secondary
                        disabled={removing}
                        label={t('removeModel')}
                        onPress={() => {
                          Alert.alert(model.title, t('removeModelConfirm'), [
                            { text: t('cancel'), style: 'cancel' },
                            {
                              text: t('removeModel'),
                              style: 'destructive',
                              onPress: () => {
                                void remove(id);
                              },
                            },
                          ]);
                        }}
                      />
                    </>
                  ) : (
                    <Button
                      disabled={removing}
                      label={t('download')}
                      onPress={() => {
                        void download(id);
                      }}
                    />
                  )}
                </Card>
              );
            })}
        </View>
      ))}
    </>
  );
}
export default function ModelsScreen() {
  const { t } = useTranslation();
  return (
    <Page title={t('models')} back>
      <ModelsContent />
      <Card>
        <Text style={styles.heading}>{t('workflow')}</Text>
        {(['dictation', 'upload', 'cleanup', 'notes', 'agent'] as const).map((scope) => (
          <Row
            key={scope}
            title={t(
              scope === 'dictation'
                ? 'dictate'
                : scope === 'notes'
                  ? 'formatting'
                  : scope === 'agent'
                    ? 'assistant'
                    : scope,
            )}
            onPress={() => router.push({ pathname: '/(account)/ai-workflow', params: { scope } })}
          />
        ))}
      </Card>
    </Page>
  );
}
