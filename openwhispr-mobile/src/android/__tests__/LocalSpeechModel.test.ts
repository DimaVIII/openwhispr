jest.mock('../../../modules/android-dictation/src', () => ({
  AndroidDictation: {
    transcribeParakeet: jest.fn(),
    cancelParakeet: jest.fn(),
  },
}));
jest.mock('../models', () => ({
  modelReady: jest.fn(),
  modelPath: () => 'file:///models/parakeet-v3',
}));
jest.mock('../LocalTextModel', () => ({
  LocalTextModel: { release: jest.fn(async () => undefined) },
}));

import { LocalSpeechModel } from '../LocalSpeechModel';
import { LocalTextModel } from '../LocalTextModel';
import { AndroidDictation } from '../../../modules/android-dictation/src';
import { modelReady } from '../models';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(modelReady).mockResolvedValue(true);
  jest.mocked(AndroidDictation!.transcribeParakeet).mockResolvedValue({
    text: 'Hello.',
    duration: 1,
    processingMs: 120,
    tokenTimings: [
      { token: ' Hello', startTime: 0, endTime: 0.5 },
      { token: '.', startTime: 0.5, endTime: 0.5 },
    ],
  });
});
it('uses Parakeet with shared word timings and frees the text runtime first', async () => {
  const result = await LocalSpeechModel.transcribe('file:///sample.wav', {
    wordTimestamps: true,
    language: 'en-US',
  });
  expect(result).toMatchObject({
    endpoint: 'parakeet-v3',
    provider: 'local',
    segments: [{ text: 'Hello.', t0: 0, t1: 50 }],
  });
  expect(AndroidDictation!.transcribeParakeet).toHaveBeenCalledWith(
    'file:///sample.wav',
    'file:///models/parakeet-v3',
  );
  expect(jest.mocked(LocalTextModel.release).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(AndroidDictation!.transcribeParakeet).mock.invocationCallOrder[0],
  );
});
it('refuses unsupported languages instead of silently sending them elsewhere', async () => {
  await expect(
    LocalSpeechModel.transcribe('file:///sample.wav', { language: 'ja' }),
  ).rejects.toThrow('25 European');
  expect(AndroidDictation!.transcribeParakeet).not.toHaveBeenCalled();
});
it('refuses missing model weights without invoking the runtime', async () => {
  jest.mocked(modelReady).mockResolvedValue(false);
  await expect(LocalSpeechModel.transcribe('file:///sample.wav', {})).rejects.toThrow('download');
  expect(AndroidDictation!.transcribeParakeet).not.toHaveBeenCalled();
});
it('discards a native result when cancellation arrives during inference', async () => {
  jest.mocked(AndroidDictation!.transcribeParakeet).mockImplementation(async () => {
    LocalSpeechModel.cancel();
    return { text: 'Discard me', duration: 1, processingMs: 10, tokenTimings: [] };
  });
  await expect(LocalSpeechModel.transcribe('file:///sample.wav', {})).rejects.toThrow('cancelled');
  expect(AndroidDictation!.cancelParakeet).toHaveBeenCalled();
});
