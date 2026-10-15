import { AndroidDictation } from '../../modules/android-dictation/src';
import { modelPath, modelReady } from './models';
import { LocalTextModel } from './LocalTextModel';
import { withAndroidInference } from './inferenceQueue';
import { tokenTimingsToWhisperSegments } from '@/services/transcription/parakeetSegments';
import type { TranscriptionResponse } from '@/types';

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
      if (job !== generation) throw new Error('Dictation cancelled.');
      const language = options.language?.toLowerCase().split(/[-_]/)[0];
      if (language && language !== 'auto' && !PARAKEET_LANGUAGES.has(language))
        throw new Error(
          'Parakeet supports 25 European languages. Choose a supported language or a cloud/provider workflow for this language.',
        );
      if (!(await modelReady('parakeet-v3')))
        throw new Error('Parakeet model is not available. Please download it first from Models.');
      await LocalTextModel.release();
      if (job !== generation) throw new Error('Dictation cancelled.');
      const result = await AndroidDictation!.transcribeParakeet(uri, modelPath('parakeet-v3'));
      if (job !== generation) throw new Error('Dictation cancelled.');
      if (__DEV__)
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
