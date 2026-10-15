import { initLlama, type LlamaContext } from 'llama.rn';
import { modelPath, modelReady, type AndroidModelId } from './models';
import type { ReasoningRequest, ReasoningResponse, LocalReasoningReadiness } from '@/types';
import { useConfigStore } from '@/store/useConfigStore';
import { AndroidDictation } from '../../modules/android-dictation/src';
import { withAndroidInference } from './inferenceQueue';

let context: LlamaContext | null = null;
let loaded: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}
export function selectedTextModel(): AndroidModelId {
  return useConfigStore.getState().config?.androidTextModel === 'qwen-small'
    ? 'qwen-small'
    : 'qwen-balanced';
}
export async function androidTextReadiness(): Promise<LocalReasoningReadiness> {
  return {
    status: (await modelReady(selectedTextModel())) ? 'ready' : 'modelNotReady',
    contextSize: 4096,
    tokenCounting: false,
  };
}
export const LocalTextModel = {
  async processText(request: ReasoningRequest): Promise<ReasoningResponse> {
    const model = selectedTextModel();
    return withAndroidInference(() =>
      exclusive(async () => {
        if (request.signal?.aborted) throw new Error('Generation cancelled.');
        await AndroidDictation!.releaseParakeet();
        if (!(await modelReady(model)))
          throw new Error('Download the local text model in Account → Models first.');
        if (!context || loaded !== model) {
          if (context) await context.release();
          context = null;
          loaded = null;
          context = await initLlama({
            model: modelPath(model),
            n_ctx: 4096,
            n_threads: 4,
            n_gpu_layers: 0,
            use_mlock: false,
          });
          loaded = model;
        }
        const engine = context;
        const stop = () => {
          // llama.rn's JSI implementation can return void despite its Promise type.
          void Promise.resolve()
            .then(() => engine.stopCompletion())
            .catch(() => undefined);
        };
        request.signal?.addEventListener('abort', stop, { once: true });
        try {
          const startedAt = Date.now();
          const result = await engine.completion({
            messages: [
              {
                role: 'system',
                content:
                  request.systemPrompt || 'Follow the instruction. Return only the requested text.',
              },
              { role: 'user', content: request.text },
            ],
            n_predict: Math.min(request.maxTokens ?? 384, 900),
            temperature: request.temperature ?? 0,
            stop: ['<|im_end|>', '<|endoftext|>'],
          });
          if (request.signal?.aborted) throw new Error('Generation cancelled.');
          if (result.stopped_limit)
            throw new Error('The local response was too long. Try a shorter request.');
          if (__DEV__)
            console.log(`[android-reasoning] model=${model} elapsedMs=${Date.now() - startedAt}`);
          const text = result.text.trim();
          if (!text) throw new Error('The local model returned no text. Try again.');
          return { text, model };
        } finally {
          request.signal?.removeEventListener('abort', stop);
        }
      }),
    );
  },
  async release(): Promise<void> {
    return exclusive(async () => {
      if (context) await context.release();
      context = null;
      loaded = null;
    });
  },
};
