jest.mock('llama.rn', () => ({ initLlama: jest.fn() }));
jest.mock('../models', () => ({ modelPath: () => '/model.gguf', modelReady: async () => true }));
jest.mock('@/store/useConfigStore', () => ({
  useConfigStore: { getState: () => ({ config: { androidTextModel: 'qwen-balanced' } }) },
}));
jest.mock('../../../modules/android-dictation/src', () => ({
  AndroidDictation: { releaseParakeet: jest.fn(async () => undefined) },
}));

import { initLlama } from 'llama.rn';
import { LocalTextModel } from '../LocalTextModel';
import { withRetry, createApiRetryStrategy } from '@/lib/retry';

it('does not repeat failed native model initialization as a network retry', async () => {
  const load = jest
    .mocked(initLlama)
    .mockClear()
    .mockRejectedValue(new Error('Model initialization failed'));
  await expect(
    withRetry(() => LocalTextModel.processText({ text: 'A short message.' }), {
      ...createApiRetryStrategy(),
      maxRetries: 1,
      initialDelay: 0,
    }),
  ).rejects.toThrow('Model initialization failed');
  expect(load).toHaveBeenCalledTimes(1);
});

it('does not run a failed local generation again under the shared network retry policy', async () => {
  const completion = jest.fn(async () => {
    throw new Error('Local generation failed');
  });
  jest.mocked(initLlama).mockResolvedValue({ completion, release: jest.fn() } as never);
  await expect(
    withRetry(() => LocalTextModel.processText({ text: 'A short message.' }), {
      ...createApiRetryStrategy(),
      maxRetries: 1,
      initialDelay: 0,
    }),
  ).rejects.toThrow('Local generation failed');
  expect(completion).toHaveBeenCalledTimes(1);
  await LocalTextModel.release();
});

it('does not begin generation when cancellation happens during model loading', async () => {
  const controller = new AbortController();
  const completion = jest.fn();
  jest.mocked(initLlama).mockImplementationOnce(async () => {
    controller.abort();
    return { completion, release: jest.fn() } as never;
  });
  await expect(
    LocalTextModel.processText({ text: 'A message.', signal: controller.signal }),
  ).rejects.toMatchObject({ retryable: false });
  expect(completion).not.toHaveBeenCalled();
  await LocalTextModel.release();
});
