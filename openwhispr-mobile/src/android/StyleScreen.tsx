import { useState } from 'react';
import { router } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useConfigStore } from '@/store/useConfigStore';
import type { KeyboardTone } from '@/types';
import { Page, Card, Button, Row, styles, palette } from './ui';

const TONES = ['default', 'formal', 'casual', 'very_casual', 'excited'] as const;
const CONTEXTS = ['personal', 'work', 'email', 'notes'] as const;

export default function StyleScreen() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const context = config?.androidStyleContext ?? 'personal';
  const selectedTone = config?.androidStyleTones?.[context] ?? config?.keyboardTone ?? 'default';
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTone = async (tone: KeyboardTone) => {
    if (saving) return;
    setSaving(true);
    try {
      const current = useConfigStore.getState().config;
      await useConfigStore
        .getState()
        .updateConfig({ androidStyleTones: { ...current?.androidStyleTones, [context]: tone } });
      setChoosing(false);
    } catch (error) {
      Alert.alert(t('errorTitle'), (error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Page title={t('style')}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('styleTitle')}
      </Text>
      <Text style={styles.body}>{t('styleBody')}</Text>
      <SegmentedControl
        value={context}
        scrollable
        options={CONTEXTS.map((value) => ({ value, label: t(value) }))}
        onChange={(value) => {
          void useConfigStore
            .getState()
            .updateConfig({ androidStyleContext: value })
            .catch((error: Error) => Alert.alert(t('errorTitle'), error.message));
        }}
      />
      <Card>
        <Row title={t(selectedTone)} detail={t('tone')} onPress={() => setChoosing(true)} />
        <View style={{ backgroundColor: palette.soft, padding: 20, borderRadius: 14, gap: 14 }}>
          <Text style={[styles.caption, { color: palette.blue }]}>{t('examplePreview')}</Text>
          <Text style={{ fontSize: 18, lineHeight: 28, color: palette.ink }}>
            {t(`tonePreview_${selectedTone}`)}
          </Text>
        </View>
      </Card>
      {config?.cleanupEnabled === false && (
        <Text style={styles.body}>{t('styleNeedsCleanup')}</Text>
      )}
      <Row
        title={t('prompt')}
        icon="SlidersHorizontal"
        onPress={() => router.push('/(account)/cleanup-prompt')}
      />
      <Modal
        visible={choosing}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!saving) setChoosing(false);
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' }}>
          <Pressable
            cssInterop={false}
            accessibilityLabel={t('close')}
            accessibilityRole="button"
            disabled={saving}
            onPress={() => setChoosing(false)}
            style={{ flex: 1 }}
          />
          <SafeAreaView
            edges={['bottom']}
            style={{
              backgroundColor: palette.background,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              maxHeight: '85%',
            }}
          >
            <ScrollView contentContainerStyle={styles.content}>
              <Text accessibilityRole="header" style={styles.heading}>
                {t('tone')}
              </Text>
              <Card style={{ paddingVertical: 4, gap: 0 }}>
                {TONES.map((tone) => (
                  <Pressable
                    cssInterop={false}
                    key={tone}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedTone === tone, disabled: saving }}
                    disabled={saving}
                    onPress={() => {
                      void saveTone(tone);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      { minHeight: 56, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={{ fontSize: 17, color: palette.ink }}>{t(tone)}</Text>
                    {selectedTone === tone && (
                      <SystemIcon name="checkmark" mdName="Check" color={palette.blue} size={20} />
                    )}
                  </Pressable>
                ))}
              </Card>
              <Button
                secondary
                disabled={saving}
                label={t('cancel')}
                onPress={() => setChoosing(false)}
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </Page>
  );
}
