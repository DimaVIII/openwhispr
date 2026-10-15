import { AppleLLM } from '@/lib/appleLLM';
import { LocalReasoningService } from '../LocalReasoningService';

jest.mock('@/lib/appleLLM', () => ({
  AppleLLM: { generateText: jest.fn() },
}));

const mockGenerateText = AppleLLM.generateText as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

it('passes the caller signal to Apple Intelligence so a timeout stops the run', async () => {
  mockGenerateText.mockResolvedValue({ text: ' Hello. ', model: 'apple-foundation-models' });
  const { signal } = new AbortController();

  await expect(
    LocalReasoningService.processText({ text: 'um hello', systemPrompt: 'Clean up.', signal }),
  ).resolves.toEqual({ text: 'Hello.', model: 'apple-fm' });
  expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'um hello' }), {
    signal,
  });
});

it('reports an aborted run as a cancelled local request', async () => {
  mockGenerateText.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));

  await expect(
    LocalReasoningService.processText({ text: 'um hello', systemPrompt: 'Clean up.' }),
  ).rejects.toMatchObject({ name: 'LocalReasoningError', code: 'APPLE_LLM_CANCELLED' });
});
