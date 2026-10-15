import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/ui/Text';
import { Button, Card, Page, styles } from './ui';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useSuperwallGate } from '@/hooks/useSuperwallGate';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotesStore } from '@/store/useNotesStore';
import { useProcessingModeStore } from '@/store/useProcessingModeStore';
import { useConfigStore } from '@/store/useConfigStore';
import { useUsageStore } from '@/store/useUsageStore';
import { snapshotTranscriptionJob } from '@/lib/inferenceRouting';
import { accountRequiredForCloud, showAccountRequiredAlert } from '@/lib/accountAccess';
import { buildUsageGateParams, SUPERWALL_PLACEMENTS } from '@/lib/superwall';
import {
  resolveImportDestination,
  saveImportedNote,
  type ImportDestination,
} from '@/lib/notes/importDestination';

function parseId(value?: string): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error('This destination is invalid. Return to Notes.');
  return id;
}

export default function ImportAudioScreen() {
  const params = useLocalSearchParams<{ folderId?: string; spaceId?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const mode = useProcessingModeStore((state) => state.activeMode);
  // Refresh the preview when workflow configuration changes; the job takes its
  // own snapshot before the paywall or picker opens.
  useConfigStore((state) => state.config?.inference);
  const { register } = useSuperwallGate();
  const focused = useRef(true);
  const accountChanged = useRef(false);
  const requestBusy = useRef(false);
  const requestGeneration = useRef(0);
  const processingChoice = useRef<{
    isPrivate: boolean;
    provider: string;
    remoteCleanup: boolean;
  } | null>(null);
  const destination = useRef<ImportDestination | null>(null);
  const [gating, setGating] = useState(false);
  const [error, setError] = useState('');
  const [completedNoteId, setCompletedNoteId] = useState<number | null>(null);
  const pendingNavigation = useRef<NavigationAction | null>(null);
  const preview = (() => {
    try {
      const target = resolveImportDestination({
        folderId: parseId(params.folderId),
        spaceId: parseId(params.spaceId),
        isPrivate: mode === 'private',
      });
      const route = snapshotTranscriptionJob('upload');
      return { target, route, error: '' };
    } catch (cause) {
      return { target: null, route: null, error: (cause as Error).message };
    }
  })();
  const { isProcessing, currentText, stage, cancel, pickAndTranscribeFile } = useFileUpload({
    saveToHistory: false,
    isCurrent: () =>
      focused.current &&
      !accountChanged.current &&
      destination.current?.ownerId === (useAuthStore.getState().user?.id ?? null),
    onComplete: (text, fileName) => {
      if (!destination.current) return;
      const note = saveImportedNote(destination.current, text, fileName);
      setCompletedNoteId(note.id);
      useNotesStore.getState().loadNotes();
      useNotesStore.getState().loadFolders();
    },
    onError: (cause) => setError(cause.message),
  });
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        requestGeneration.current += 1;
        cancel();
      };
    }, [cancel]),
  );
  useEffect(
    () =>
      useAuthStore.subscribe((state, previous) => {
        if (state.user?.id !== previous.user?.id) {
          accountChanged.current = true;
          cancel();
          setError('Your account changed. Return to Notes and start a new import.');
        }
      }),
    [cancel],
  );
  usePreventRemove(isProcessing, ({ data }) => {
    Alert.alert('Cancel import?', 'This import will stop without creating a note.', [
      { text: 'Keep importing', style: 'cancel' },
      {
        text: 'Cancel import',
        style: 'destructive',
        onPress: () => {
          pendingNavigation.current = data.action;
          cancel();
        },
      },
    ]);
  });
  useEffect(() => {
    if (isProcessing) return;
    if (pendingNavigation.current) {
      const action = pendingNavigation.current;
      pendingNavigation.current = null;
      navigation.dispatch(action);
    } else if (completedNoteId != null) {
      router.replace(`/(tabs)/(notes)/${completedNoteId}`);
    }
  }, [isProcessing, completedNoteId, navigation, router]);

  const start = async () => {
    if (
      requestBusy.current ||
      isProcessing ||
      accountChanged.current ||
      !preview.target ||
      !preview.route
    )
      return;
    const route = preview.route;
    const user = useAuthStore.getState().user;
    if (route.provider === 'cloud' && accountRequiredForCloud(user)) {
      showAccountRequiredAlert('audio import');
      return;
    }
    destination.current = preview.target;
    processingChoice.current = {
      isPrivate: preview.target.isPrivate,
      provider: route.provider,
      remoteCleanup: route.cleanupRoute?.mode === 'providers',
    };
    const requestId = ++requestGeneration.current;
    requestBusy.current = true;
    setError('');
    setGating(true);
    let began = false;
    const begin = () => {
      if (
        began ||
        !focused.current ||
        accountChanged.current ||
        requestId !== requestGeneration.current
      )
        return;
      began = true;
      void pickAndTranscribeFile(route).catch(() => undefined);
    };
    try {
      if (route.provider === 'cloud' && user) {
        const usage = useUsageStore.getState().usage;
        await register({
          placement: SUPERWALL_PLACEMENTS.audioUploadStart,
          params: usage ? buildUsageGateParams(usage) : undefined,
          requiresAccount: false,
          feature: begin,
        });
      } else begin();
    } catch (cause) {
      if (focused.current) setError((cause as Error).message);
    } finally {
      requestBusy.current = false;
      if (focused.current) setGating(false);
    }
  };
  const choice =
    isProcessing || gating
      ? processingChoice.current
      : {
          isPrivate: mode === 'private',
          provider: preview.route?.provider,
          remoteCleanup: preview.route?.cleanupRoute?.mode === 'providers',
        };
  return (
    <Page title="Import audio" back showAccount={false}>
      <Card>
        <Text style={styles.heading}>Turn audio into a note</Text>
        <Text style={styles.body}>
          Choose a WAV, MP3, M4A, AAC, OGG/Opus or WEBM file. Recording stays off.
        </Text>
        <Text
          style={styles.body}
        >{`Save to: ${(isProcessing ? destination.current : preview.target)?.label ?? 'Unavailable'}`}</Text>
        <Text style={styles.body}>
          {choice?.isPrivate
            ? choice.remoteCleanup
              ? 'Audio is transcribed on this phone. Transcript text is sent to your selected cleanup provider. The note is saved privately; imports from a shared space go to Personal.'
              : 'Private import: processed on this phone and saved as a private note. A shared-space import is saved in Personal.'
            : choice?.provider === 'local'
              ? 'Audio is transcribed on this phone. Cleanup follows your AI workflow settings. The note follows your sync settings.'
              : choice?.provider === 'byok'
                ? 'Audio is sent to your selected provider. The note follows your sync settings.'
                : 'Audio is sent to OpenWhispr Cloud. The note follows your sync settings.'}
        </Text>
        {isProcessing ? (
          <>
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {stage === 'cleaning' ? 'Formatting transcript…' : 'Importing audio…'}
            </Text>
            <Button label="Cancel import" secondary onPress={cancel} />
          </>
        ) : (
          <Button
            label="Choose audio file"
            disabled={gating || accountChanged.current || !!preview.error}
            onPress={() => {
              void start();
            }}
          />
        )}
      </Card>
      {error || preview.error ? (
        <Card>
          <Text style={styles.heading} accessibilityRole="alert">
            Could not import audio
          </Text>
          <Text style={styles.body}>{error || preview.error}</Text>
          <Button
            label="Models & processing"
            secondary
            onPress={() => router.push('/(account)/ai-models')}
          />
        </Card>
      ) : null}
      {currentText ? (
        <Card>
          <Text style={styles.heading}>Transcript</Text>
          <Text style={styles.body} selectable>
            {currentText}
          </Text>
          {!isProcessing && error ? (
            <Button
              label="Copy transcript"
              secondary
              onPress={() => {
                void Clipboard.setStringAsync(currentText)
                  .then(() => Alert.alert('Copied', 'Transcript copied.'))
                  .catch(() => Alert.alert('Could not copy', 'Try again.'));
              }}
            />
          ) : null}
        </Card>
      ) : null}
    </Page>
  );
}
