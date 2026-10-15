import type { ReasoningRequest } from '@/types';
export { LocalTextModel as LocalReasoningService } from '@/android/LocalTextModel';
export function buildLocalReasoningInstructions(request: ReasoningRequest): string {
  return request.systemPrompt?.trim() ?? '';
}
