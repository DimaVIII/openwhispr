import { AndroidDictation } from '../../modules/android-dictation/src';
import { modelPath, modelReady } from './models';
import { LocalTextModel } from './LocalTextModel';
import { withAndroidInference } from './inferenceQueue';
import { tokenTimingsToWhisperSegments } from '@/services/transcription/parakeetSegments';
import type { TranscriptionResponse } from '@/types';
import i18n from './strings';
import Constants from 'expo-constants';

const diagnostics = __DEV__ || Constants.expoConfig?.extra?.openWhispr?.isDevelopment === true;

export const PARAKEET_LANGUAGES = new Set([
  'bg',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fi',
  'fr',
  'de',
  'el',
  'hu',
  'it',
  'lv',
  'lt',
  'mt',
  'pl',
  'pt',
  'ro',
  'sk',
  'sl',
  'es',
  'sv',
  'ru',
  'uk',
]);
let generation = 0;
export const LocalSpeechModel = {
  async transcribe(
    uri: string,
    options: { language?: string; wordTimestamps?: boolean },
  ): Promise<TranscriptionResponse> {
    const job = generation;
    return withAndroidInference(async () => {
      if (job !== generation) throw new Error(i18n.t('cancelled'));
      const language = options.language?.toLowerCase().split(/[-_]/)[0];
      if (language && language !== 'auto' && !PARAKEET_LANGUAGES.has(language))
        throw new Error(i18n.t('unsupportedLanguage'));
      if (!(await modelReady('parakeet-v3'))) throw new Error(i18n.t('speechUnavailable'));
      await LocalTextModel.release();
      if (job !== generation) throw new Error(i18n.t('cancelled'));
      // The native engine decodes compressed uploads and owns its temporary PCM file.
      const result = await AndroidDictation!.transcribeParakeet(uri, modelPath('parakeet-v3'));
      if (job !== generation) throw new Error(i18n.t('cancelled'));
      if (diagnostics)
        console.log(`[android-speech] model=parakeet-v3 elapsedMs=${result.processingMs}`);
      return {
        text: result.text,
        duration: result.duration,
        processingMs: result.processingMs,
        provider: 'local',
        endpoint: 'parakeet-v3',
        ...(options.wordTimestamps
          ? { segments: tokenTimingsToWhisperSegments(result.tokenTimings) }
          : {}),
      };
    });
  },
  cancel() {
    generation++;
    AndroidDictation?.cancelParakeet();
  },
};
