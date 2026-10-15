import { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  PermissionsAndroid,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/Text';
import { OpenWhisprMark } from '@/components/ui/OpenWhisprMark';
import { AndroidDictation, type Recording } from '../../modules/android-dictation/src';
import {
  AndroidCleanupError,
  createAndroidJob,
  processAndroidAudio,
  ensureAndroidModels,
  type DictationMode,
  type AndroidJob,
} from './pipeline';
import { Button, Card, styles, palette } from './ui';
import { LanguageSheet } from './LanguageSheet';
import { useBubbleResult } from './bubbleResult';

export function Practice({
  initialMode = 'dictate',
  onSuccess,
}: {
  initialMode?: DictationMode;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DictationMode>(initialMode);
  const [text, setText] = useState(initialMode === 'edit' ? t('editSeed') : '');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState({ code: 'es', label: 'Spanish' });
  const [languages, setLanguages] = useState(false);
  const active = useRef(false);
  const starting = useRef(false);
  const stopWhenReady = useRef<'finish' | 'cancel' | null>(null);
  const mounted = useRef(true);
  const recordingLimit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceSnapshot = useRef({ text: '', start: 0, end: 0 });
  const longPress = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const captured = useRef<AndroidJob | null>(null);
  const selection = useRef({ start: 0, end: 0 });
  useEffect(() => {
    setMode(initialMode);
    setText(initialMode === 'edit' ? t('editSeed') : '');
    setStatus('');
  }, [initialMode, t]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopWhenReady.current = 'cancel';
      if (recordingLimit.current) clearTimeout(recordingLimit.current);
      controller.current?.abort();
      if (active.current) AndroidDictation?.stopRecording(true).catch(() => undefined);
    };
  }, []);
  const run = async (audio: Recording, job: AndroidJob, owned: boolean) => {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setStatus('processing');
    try {
      const result = await processAndroidAudio(audio, job, abort.signal, (value) => {
        if (!abort.signal.aborted && mounted.current) setStatus(value);
      });
      if (abort.signal.aborted || !mounted.current) return;
      const original = sourceSnapshot.current;
      if (job.mode === 'edit' && original.end > original.start) {
        setText(
          original.text.slice(0, original.start) + result + original.text.slice(original.end),
        );
      } else setText(result);
      setStatus('success');
      onSuccess?.();
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current) {
        if (failure instanceof AndroidCleanupError) {
          useBubbleResult.getState().setResult(failure.transcript, t('cleanupRecovery'));
          setError(t('cleanupRecovery'));
        } else setError((failure as Error).message);
        setStatus('');
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        if (mounted.current) setBusy(false);
      }
      if (owned)
        await FileSystem.deleteAsync(audio.uri, { idempotent: true }).catch(() => undefined);
    }
  };
  const stop = async (cancel = false) => {
    if (starting.current) {
      stopWhenReady.current = cancel ? 'cancel' : (stopWhenReady.current ?? 'finish');
      if (cancel) controller.current?.abort();
      return;
    }
    if (!active.current) {
      controller.current?.abort();
      setBusy(false);
      setStatus('');
      return;
    }
    active.current = false;
    if (recordingLimit.current) clearTimeout(recordingLimit.current);
    if (mounted.current) setRecording(false);
    try {
      const audio = await AndroidDictation!.stopRecording(cancel);
      if (!cancel && captured.current) await run(audio, captured.current, true);
      else setStatus('');
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const start = async () => {
    if (starting.current || active.current || busy) return;
    starting.current = true;
    stopWhenReady.current = null;
    setError('');
    try {
      sourceSnapshot.current = { text, ...selection.current };
      const selected =
        selection.current.end > selection.current.start
          ? text.slice(selection.current.start, selection.current.end)
          : text;
      const job = createAndroidJob(mode, target.label, selected);
      await ensureAndroidModels(job);
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error(t('permissionDenied'));
      if (!mounted.current || stopWhenReady.current === 'cancel') return;
      await AndroidDictation!.startRecording();
      active.current = true;
      captured.current = job;
      setRecording(true);
      setStatus('listening');
      recordingLimit.current = setTimeout(
        () => {
          void stop();
        },
        5 * 60 * 1000,
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      starting.current = false;
      if (stopWhenReady.current && active.current) void stop(stopWhenReady.current === 'cancel');
    }
  };
  const importAudio = async () => {
    let importedUri: string | undefined;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      importedUri = file.uri;
      sourceSnapshot.current = { text, ...selection.current };
      const selected =
        selection.current.end > selection.current.start
          ? text.slice(selection.current.start, selection.current.end)
          : text;
      const job = createAndroidJob(mode, target.label, selected);
      await ensureAndroidModels(job);
      const decoded = await AndroidDictation!.decodeAudio(file.uri);
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
      await run(decoded, job, true);
    } catch (failure) {
      Alert.alert(t('errorTitle'), (failure as Error).message);
    } finally {
      if (importedUri)
        await FileSystem.deleteAsync(importedUri, { idempotent: true }).catch(() => undefined);
    }
  };
  return (
    <View style={{ gap: 16 }}>
      <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'flex-start' }]}>
        {(['dictate', 'translate', 'write', 'edit'] as const).map((item) => (
          <Pressable
            disabled={busy || recording || Boolean(onSuccess)}
            accessibilityRole="button"
            key={item}
            onPress={() => {
              setMode(item);
              setStatus('');
            }}
            style={[
              styles.pill,
              mode === item && { backgroundColor: palette.soft, borderColor: palette.blue },
            ]}
          >
            <Text>{t(item)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.body}>{t(`${mode}Example`)}</Text>
      {mode === 'translate' && (
        <Button
          secondary
          label={`${t('targetLanguage')} · ${target.label}`}
          onPress={() => setLanguages(true)}
        />
      )}
      <Card>
        <View style={styles.row}>
          <Text style={{ fontSize: 24 }}>☺</Text>
          <TextInput
            multiline
            editable={!busy && !recording}
            accessibilityLabel={t('messagePlaceholder')}
            placeholder={t('messagePlaceholder')}
            value={text}
            onChangeText={setText}
            onSelectionChange={(event) => {
              selection.current = event.nativeEvent.selection;
            }}
            style={{
              flex: 1,
              minHeight: 100,
              fontSize: 18,
              color: palette.ink,
              textAlignVertical: 'top',
            }}
          />
          <Text style={{ color: palette.blue, fontSize: 25 }}>➤</Text>
        </View>
      </Card>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: '#A32D35', lineHeight: 22 }}>
          {error}
        </Text>
      ) : null}
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.caption,
            { textAlign: 'center', color: status === 'success' ? '#27704A' : palette.muted },
          ]}
        >
          {t(status, { defaultValue: status })}
        </Text>
      ) : null}
      <View style={[styles.row, { justifyContent: 'center', gap: 24 }]}>
        {(recording || busy) && (
          <Button
            secondary
            label={t('cancel')}
            onPress={() => {
              void stop(true);
            }}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(recording ? 'finish' : 'hold')}
          disabled={busy}
          onPressIn={() => {
            longPress.current = false;
          }}
          onLongPress={() => {
            longPress.current = true;
            void start();
          }}
          delayLongPress={250}
          onPressOut={() => {
            if (longPress.current) {
              void stop();
            }
          }}
          onPress={() => {
            if (!longPress.current) {
              if (active.current) void stop();
              else void start();
            }
          }}
          style={{
            width: 82,
            height: 82,
            borderRadius: 30,
            backgroundColor: palette.blue,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : recording ? (
            <Text style={{ fontSize: 26, color: 'white' }}>■</Text>
          ) : (
            <OpenWhisprMark size={42} color="white" />
          )}
        </Pressable>
      </View>
      <Text style={[styles.caption, { textAlign: 'center' }]}>{t('hold')}</Text>
      <Button
        secondary
        disabled={busy || recording}
        label={t('sample')}
        onPress={() => {
          void importAudio();
        }}
      />
      <LanguageSheet
        visible={languages}
        allowAuto={false}
        selected={target.code}
        onClose={() => setLanguages(false)}
        onSelect={(code, label) => setTarget({ code, label })}
      />
    </View>
  );
}
