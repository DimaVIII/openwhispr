import type { InferenceSelection } from '@/lib/mobileProviders';
import { MODE_LABELS } from '@/lib/inferenceModes';
import { isLocalModelKey, LOCAL_MODEL_TITLES } from '@/lib/localModelCatalog';
import { providerDisplayName, type MobileInferenceScope } from '@/lib/mobileProviders';
import type { InferenceMode, ProcessingMode, UserConfig } from '@/types';

export const WORKFLOW_LABELS: Record<MobileInferenceScope, string> = {
  dictation: 'Dictation',
  upload: 'Uploads',
  cleanup: 'Text Cleanup',
  notes: 'Note Formatting & Titles',
  agent: 'Chat & Voice Assistant',
};

export const WORKFLOWS = Object.keys(WORKFLOW_LABELS) as MobileInferenceScope[];

// Bring Your Own Key dictation skips these workflows until a selection is saved for them.
export const UNSET_PROVIDER_NOTES: Partial<Record<MobileInferenceScope, string>> = {
  cleanup: 'Not saved yet. Cleanup is skipped until you save a selection.',
  agent:
    'Not saved yet. The voice assistant is skipped until you save a selection; note chat uses OpenWhispr Cloud.',
};

// On-Device cleanup on an iPhone that can never run Apple Intelligence.
export const ON_DEVICE_CLEANUP_UNSUPPORTED_NOTE =
  "This iPhone can't run On-Device cleanup, so it's skipped. Choose Bring Your Own Key to clean up transcripts.";

// What Private mode means for each workflow other than dictation.
export const ON_DEVICE_MODE_NOTES: Partial<Record<MobileInferenceScope, string>> = {
  upload: 'Local Mode keeps uploads on this iPhone.',
  notes: 'Local Mode formats notes on this iPhone and asks before sending one to your choice here.',
  cleanup:
    'In Local Mode, cleanup runs on this iPhone, or sends only the transcript text to your provider with Bring Your Own Key.',
  agent:
    'In Local Mode the voice assistant is off, and note chat asks before sending a note off this iPhone.',
};

// Modes Private mode never runs for a workflow, so its page can't offer them as if they would.
// Dictation keeps Bring Your Own Key, since saving it leaves Private mode (no account needed).
// Notes and chat keep every mode: Private mode asks before sending a note to the one chosen.
export const PRIVATE_MODE_LOCKED: Partial<Record<MobileInferenceScope, InferenceMode[]>> = {
  dictation: ['openwhispr'],
  upload: ['openwhispr', 'providers'],
  cleanup: ['openwhispr'],
};

export const PRIVATE_MODE_LOCKED_REASON = 'Off while Local Mode is on. Turn it off in AI Models.';

// Local Mode cleans transcripts On-Device, like every other workflow, unless a provider is saved
// for cleanup, which is the user's consent to send it the text. Outside Local Mode, cleanup runs
// On-Device only when it is saved as On-Device.
export function cleanupRunsOnDevice(
  config: UserConfig | null,
  activeMode: ProcessingMode,
): boolean {
  const mode = config?.inference?.cleanup?.mode;
  return mode === 'local' || (activeMode === 'private' && mode !== 'providers');
}

export function parseWorkflow(value: unknown): MobileInferenceScope | null {
  return WORKFLOWS.find((scope) => scope === value) ?? null;
}

// What a workflow with no saved selection runs: On-Device mode keeps everything
// local except note chat, which uses OpenWhispr Cloud when unset in every mode, and
// Bring Your Own Key dictation waits for a provider before cleanup or the agent.
export function unsetSelection(
  scope: MobileInferenceScope,
  activeMode: ProcessingMode,
): InferenceSelection {
  if (activeMode === 'private')
    return scope === 'agent' ? { mode: 'openwhispr' } : { mode: 'local' };
  if (activeMode === 'providers' && (scope === 'dictation' || UNSET_PROVIDER_NOTES[scope]))
    return { mode: 'providers' };
  return { mode: 'openwhispr' };
}

export function workflowSummary(
  config: UserConfig | null,
  scope: MobileInferenceScope,
  activeMode: ProcessingMode,
  {
    keyMissing = false,
    onDeviceUnavailable,
  }: {
    keyMissing?: boolean;
    // Why Apple Intelligence can't run right now, when it can't.
    onDeviceUnavailable?: string;
  } = {},
): string {
  if (scope === 'cleanup') {
    if (!(config?.cleanupEnabled ?? true)) return 'Off';
    if (cleanupRunsOnDevice(config, activeMode) && onDeviceUnavailable)
      return `Skipped · ${onDeviceUnavailable}`;
  }
  // Local Mode runs everything on this phone first, whatever is saved, cleanup included unless a
  // provider is saved for it. Only note chat set to OpenWhispr, or not set, goes straight to Cloud.
  if (activeMode === 'private') {
    const chatOnCloud = (config?.inference?.agent?.mode ?? 'openwhispr') === 'openwhispr';
    if (scope === 'agent' && chatOnCloud) return MODE_LABELS.openwhispr;
  }
  const selection = config?.inference?.[scope] ?? unsetSelection(scope, activeMode);
  if (selection.mode === 'local' && isLocalModelKey(selection.modelId))
    return LOCAL_MODEL_TITLES[selection.modelId];
  if (activeMode === 'private' && !(scope === 'cleanup' && selection.mode === 'providers'))
    return MODE_LABELS.local;
  if (selection.mode !== 'providers') return MODE_LABELS[selection.mode];
  if (!selection.providerId) return 'Not set';
  const name = providerDisplayName(selection.providerId);
  return keyMissing ? `${name} · Key missing` : name;
}
