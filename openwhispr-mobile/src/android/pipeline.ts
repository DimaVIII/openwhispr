import { transcribeAndCleanup } from '@/lib/transcribeAndCleanup';
import { snapshotTranscriptionJob, type TranscriptionJobRoute } from '@/lib/inferenceRouting';
import { getPreferredTranscriptionLanguage } from '@/lib/transcriptionLanguage';
import { ReasoningService } from '@/services/reasoning/ReasoningService';
import { LocalTranscriptionService } from '@/services/transcription/LocalTranscriptionService';
import { useConfigStore } from '@/store/useConfigStore';
import { useTranscriptStore } from '@/store/useTranscriptStore';
import { modelReady } from './models';
import { selectedTextModel } from './LocalTextModel';
import type { Recording } from '../../modules/android-dictation/src';
import type { KeyboardTone } from '@/types';
import { cleanupSavedOnDevice } from '@/lib/aiWorkflows';
import i18n from './strings';

export type DictationMode = 'dictate' | 'translate' | 'write' | 'edit';
export class AndroidCleanupError extends Error {
  constructor(
    message: string,
    readonly transcript: string,
  ) {
    super(message);
    this.name = 'AndroidCleanupError';
  }
}
export interface AndroidJob {
  route: TranscriptionJobRoute;
  mode: DictationMode;
  target: string;
  selection: string;
  language?: string;
  tone?: KeyboardTone;
}
export function createAndroidJob(
  mode: DictationMode = 'dictate',
  target = 'Spanish',
  selection = '',
): AndroidJob {
  const config = useConfigStore.getState().config;
  return {
    route: snapshotTranscriptionJob('dictation'),
    mode,
    target,
    selection,
    language: getPreferredTranscriptionLanguage(),
    tone:
      config?.androidStyleTones?.[config.androidStyleContext ?? 'personal'] ?? config?.keyboardTone,
  };
}
export async function ensureAndroidModels(job: AndroidJob): Promise<void> {
  if (job.route.provider === 'local' && !(await modelReady('parakeet-v3')))
    throw new Error(i18n.t('speechDownloadNeeded'));
  const config = useConfigStore.getState().config;
  const cleanupRuns =
    config?.cleanupEnabled !== false &&
    (job.route.provider !== 'local' || cleanupSavedOnDevice(config));
  if (
    job.route.cleanupRoute?.mode === 'local' &&
    (job.mode !== 'dictate' || cleanupRuns) &&
    !(await modelReady(selectedTextModel()))
  )
    throw new Error(i18n.t('textDownloadNeeded'));
}
export async function applyHistoryRetention(): Promise<void> {
  const days = useConfigStore.getState().config?.androidHistoryDays ?? -1;
  if (days < 0) return;
  const store = useTranscriptStore.getState();
  await store.loadTranscripts();
  const cutoff = Date.now() - days * 86400000;
  for (const item of useTranscriptStore.getState().transcripts) {
    if (item.createdAt <= cutoff) await useTranscriptStore.getState().deleteTranscript(item.id);
  }
}
export async function processAndroidAudio(
  recording: Recording,
  job: AndroidJob,
  signal: AbortSignal,
  stage: (value: string) => void,
): Promise<string> {
  if (signal.aborted) throw new Error(i18n.t('cancelled'));
  if (recording.noSpeech) throw new Error(i18n.t('noSpeech'));
  await ensureAndroidModels(job);
  if (signal.aborted) throw new Error(i18n.t('cancelled'));
  const cancelSpeech = () => {
    if (job.route.provider === 'local') void LocalTranscriptionService.cancelTranscription();
  };
  signal.addEventListener('abort', cancelSpeech, { once: true });
  const output = await transcribeAndCleanup(
    {
      ...job.route,
      audioUri: recording.uri,
      language: job.language ?? 'auto',
      mimeType: 'audio/wav',
      requestContext: 'keyboard',
      keyboardTone: job.tone,
    },
    {
      signal,
      transcriptionOnly: job.mode !== 'dictate',
      shouldCancel: () => signal.aborted,
      onStage: (value) => stage(value === 'cleaning' ? 'cleaning' : 'processing'),
    },
  ).finally(() => signal.removeEventListener('abort', cancelSpeech));
  if (signal.aborted) throw new Error(i18n.t('cancelled'));
  if (output.transcription.cleanupWarning)
    throw new AndroidCleanupError(output.transcription.cleanupWarning, output.originalText);
  let text = output.text;
  if (job.mode !== 'dictate') {
    if (job.route.cleanupUnavailable) throw new Error(job.route.cleanupUnavailable);
    stage('cleaning');
    const instruction =
      job.mode === 'translate'
        ? `Translate the supplied text into ${job.target}. Return only the translation.`
        : job.mode === 'write'
          ? 'Write the message requested by the user. Return only the message, with no introduction.'
          : 'Copy the original text exactly, changing only the words requested by the spoken instruction. Do not change any other punctuation, commas, capitalization or spacing. Return only the edited text.';
    const result = await ReasoningService.processText({
      text:
        job.mode === 'edit'
          ? `Original text:\n${job.selection}\n\nEditing instruction:\n${output.originalText}`
          : output.originalText,
      systemPrompt: instruction,
      inferenceScope: 'cleanup',
      inferenceRoute: job.route.cleanupRoute,
      routing:
        job.route.cleanupRoute?.mode === 'providers'
          ? { sendToChosenProvider: true }
          : { isPrivateNote: job.route.provider === 'local' },
      signal,
      maxTokens: 384,
    });
    text = result.text;
  }
  if (signal.aborted) throw new Error(i18n.t('cancelled'));
  if (!text.trim()) throw new Error(i18n.t('noSpeech'));
  const days = useConfigStore.getState().config?.androidHistoryDays ?? -1;
  if (days !== 0) {
    await useTranscriptStore.getState().addTranscript({
      text,
      originalText: output.originalText,
      duration: recording.durationMs / 1000,
      requestContext: 'keyboard',
      ...job.route,
    });
    await applyHistoryRetention();
  }
  return text;
}
