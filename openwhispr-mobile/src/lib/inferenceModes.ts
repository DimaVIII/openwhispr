import { Platform } from 'react-native';
import type { LucideIconName } from '@/components/ui/SystemIcon';
import type { InferenceSelection, MobileInferenceScope } from '@/lib/mobileProviders';
import {
  inferenceToProcessingMode,
  type InferenceMode,
  type ProcessingMode,
  type UserConfig,
} from '@/types';

export type ModeDescriptor = {
  mode: InferenceMode;
  icon: string;
  mdIcon: LucideIconName;
  title: string;
  description: string;
};

export type InferenceScope = 'speech' | 'text';

const BASE: Record<InferenceMode, Omit<ModeDescriptor, 'description'>> = {
  providers: { mode: 'providers', icon: 'key', mdIcon: 'KeyRound', title: 'Bring Your Own Key' },
  openwhispr: {
    mode: 'openwhispr',
    icon: 'cloud',
    mdIcon: 'Cloud',
    title: 'OpenWhispr Cloud',
  },
  local: {
    mode: 'local',
    icon: 'iphone',
    mdIcon: 'Smartphone',
    title: 'On-Device',
  },
};

const DESCRIPTIONS: Record<InferenceScope, Record<InferenceMode, string>> = {
  speech: {
    providers: 'Use your own provider key. Billed by your provider.',
    openwhispr: 'Hosted by OpenWhispr. Requires sign-in.',
    local: 'Audio never leaves this phone.',
  },
  text: {
    providers: 'Use your own provider key. Billed by your provider.',
    openwhispr: 'Hosted by OpenWhispr. Requires sign-in.',
    local: 'Text never leaves this phone.',
  },
};

export function getInferenceModes(scope: InferenceScope): ModeDescriptor[] {
  return (['openwhispr', 'local', 'providers'] as const)
    .filter((mode) => mode !== 'providers' || Platform.OS === 'ios')
    .map((mode) => ({ ...BASE[mode], description: DESCRIPTIONS[scope][mode] }));
}

export const MODE_LABELS: Record<InferenceMode, string> = {
  providers: 'Bring Your Own Key',
  openwhispr: 'OpenWhispr Cloud',
  local: 'On-Device',
};

// What a user can do on OpenWhispr Cloud, by the rules in accountAccess: any session transcribes
// there, but a separate Cloud pass over text, such as cleaning a transcript made on this iPhone,
// needs a signed-in account.
export type CloudAccess = 'none' | 'session' | 'account';

// What Local Mode runs for a workflow with nothing saved: OpenWhispr Cloud for note chat, and for
// uploads and cleanup when the account can use it there; this iPhone otherwise.
export function localModeDefault(
  scope: MobileInferenceScope,
  cloudAccess: CloudAccess,
): InferenceMode {
  const onCloud =
    scope === 'agent' ||
    (scope === 'upload' && cloudAccess !== 'none') ||
    (scope === 'cleanup' && cloudAccess === 'account');
  return onCloud ? 'openwhispr' : 'local';
}

type DictationModeConfig = Pick<UserConfig, 'defaultMode' | 'inference' | 'pinnedInference'>;

// The workflows besides dictation, which a dictation change never moves.
const OTHER_WORKFLOWS = ['upload', 'cleanup', 'notes', 'agent'] as const;
type OtherWorkflow = (typeof OTHER_WORKFLOWS)[number];

function localSelection(
  config: Pick<UserConfig, 'rememberedInference'> | null,
  scope: MobileInferenceScope,
): InferenceSelection {
  return config?.rememberedInference?.[scope]?.local ?? { mode: 'local' };
}

// What a workflow with nothing saved runs in `mode`, or undefined when there is nothing to hold:
// cleanup and the voice assistant are skipped under Bring Your Own Key until a provider is saved
// for them, and Local Mode turns the voice assistant off and asks before note chat leaves the phone.
// Note formatting saved as On-Device never falls back to Cloud, so Local Mode's is held on this
// iPhone only while Apple Intelligence can run it; otherwise Local Mode asks before using Cloud.
function unsavedRunsIn(
  config: Pick<UserConfig, 'rememberedInference'> | null,
  scope: OtherWorkflow,
  mode: ProcessingMode,
  cloudAccess: CloudAccess,
  localReasoningReady: boolean,
): InferenceSelection | undefined {
  if (mode === 'providers' && (scope === 'cleanup' || scope === 'agent')) return undefined;
  if (mode === 'private' && scope === 'agent') return undefined;
  const onDevice =
    mode === 'private' &&
    localModeDefault(scope, cloudAccess) === 'local' &&
    (scope !== 'notes' || localReasoningReady);
  return onDevice ? localSelection(config, scope) : { mode: 'openwhispr' };
}

// Onboarding's base for the dictation mode it picks. It releases the automatic pins, so onboarding
// decides those workflows again; selections the user saved themselves stay. Replaying the same
// choice keeps them.
export function dictationModeConfig(
  config: UserConfig | null,
  mode: 'cloud' | 'private',
): DictationModeConfig {
  const modeChanged = config?.defaultMode !== mode;
  const pinned = modeChanged ? (config?.pinnedInference ?? []) : [];
  const inference = Object.fromEntries(
    Object.entries(config?.inference ?? {}).filter(
      ([scope]) => !pinned.includes(scope as MobileInferenceScope),
    ),
  );
  return {
    defaultMode: mode,
    inference: {
      ...inference,
      // On-Device restores the model picked on the Dictation page.
      dictation: mode === 'private' ? localSelection(config, 'dictation') : { mode: 'openwhispr' },
    },
    ...(modeChanged && config?.pinnedInference ? { pinnedInference: undefined } : {}),
  };
}

// Onboarding saves every workflow for the mode it picks, as automatic pins (pinnedInference):
// Cloud runs them all there; Local keeps uploads, cleanup and, while Apple Intelligence can run
// it, note formatting on this iPhone, with note chat on Cloud. A selection the user saved stays,
// except that Local holds uploads and cleanup here over a saved Cloud choice (holdOnDeviceConfig).
export function onboardingModeConfig(
  config: UserConfig | null,
  mode: 'cloud' | 'private',
  localReasoningReady: boolean,
): DictationModeConfig {
  const next = dictationModeConfig(config, mode);
  const held =
    mode === 'private' ? { ...next, ...holdOnDeviceConfig({ ...config, ...next }) } : next;
  const merged = { ...config, ...held };
  const inference = { ...merged.inference };
  const pinnedInference = [...(merged.pinnedInference ?? [])];
  for (const scope of OTHER_WORKFLOWS) {
    if (inference[scope]) continue;
    inference[scope] = unsavedRunsIn(merged, scope, mode, 'none', localReasoningReady) ?? {
      mode: 'openwhispr',
    };
    if (!pinnedInference.includes(scope)) pinnedInference.push(scope);
  }
  return {
    ...held,
    inference,
    pinnedInference: pinnedInference.length ? pinnedInference : undefined,
  };
}

// Changing the dictation mode changes only dictation: the automatic pins stay, and each workflow
// with nothing saved is saved as what it ran in the mode being left, as an automatic pin.
function dictationSwitchConfig(
  config: UserConfig | null,
  dictation: InferenceSelection,
  mode: ProcessingMode,
  leavingMode: ProcessingMode,
  cloudAccess: CloudAccess,
  localReasoningReady: boolean,
): DictationModeConfig {
  const inference = { ...config?.inference, dictation };
  if (mode === leavingMode) return { defaultMode: mode, inference };
  const pinnedInference = [...(config?.pinnedInference ?? [])];
  for (const scope of OTHER_WORKFLOWS) {
    if (inference[scope]) continue;
    const selection = unsavedRunsIn(config, scope, leavingMode, cloudAccess, localReasoningReady);
    if (!selection) continue;
    inference[scope] = selection;
    if (!pinnedInference.includes(scope)) pinnedInference.push(scope);
  }
  return {
    defaultMode: mode,
    inference,
    ...(pinnedInference.length ? { pinnedInference } : {}),
  };
}

// The config a workflow page writes when the user saves `selection` for `scope`. `cloudAccess` is
// what the user has on OpenWhispr Cloud, and `localReasoningReady` whether Apple Intelligence can
// run here; together they decide what an unsaved workflow ran in Local Mode.
export function workflowSaveConfig(
  config: UserConfig | null,
  scope: MobileInferenceScope,
  selection: InferenceSelection,
  activeMode: ProcessingMode,
  cloudAccess: CloudAccess = 'none',
  localReasoningReady = false,
): Partial<UserConfig> {
  const { providerId } = selection;
  const otherProviders = Object.fromEntries(
    Object.entries(config?.rememberedInference?.[scope] ?? {}).filter(([id]) => id !== providerId),
  );
  // Most recent first, so switching back to Bring Your Own Key restores the last provider used.
  const rememberedInference = providerId
    ? {
        rememberedInference: {
          ...config?.rememberedInference,
          [scope]: { [providerId]: selection, ...otherProviders },
        },
      }
    : {};
  if (scope === 'dictation') {
    const mode = inferenceToProcessingMode(selection.mode);
    // On-Device restores the model picked on the Dictation page.
    const dictation =
      mode === 'providers'
        ? selection
        : mode === 'private'
          ? localSelection(config, 'dictation')
          : { mode: 'openwhispr' as const };
    return {
      ...rememberedInference,
      ...dictationSwitchConfig(
        config,
        dictation,
        mode,
        activeMode,
        cloudAccess,
        localReasoningReady,
      ),
    };
  }
  return {
    ...rememberedInference,
    inference: { ...config?.inference, [scope]: selection },
    ...(config?.pinnedInference
      ? { pinnedInference: config.pinnedInference.filter((pinned) => pinned !== scope) }
      : {}),
  };
}

// Holds uploads and cleanup on this iPhone unless the user saved On-Device or a provider for them.
// They are automatic pins, so only onboarding decides them again (a dictation change keeps them),
// and a pinned cleanup Apple Intelligence can't run yet is skipped quietly (skipsLocalModeCleanup).
export function holdOnDeviceConfig(
  config: Pick<UserConfig, 'inference' | 'pinnedInference' | 'rememberedInference'>,
): Pick<UserConfig, 'inference' | 'pinnedInference'> {
  const inference = { ...config.inference };
  const pinnedInference = [...(config.pinnedInference ?? [])];
  for (const scope of ['upload', 'cleanup'] as const) {
    const saved = inference[scope];
    if (saved && saved.mode !== 'openwhispr') continue;
    inference[scope] = config.rememberedInference?.[scope]?.local ?? { mode: 'local' };
    if (!pinnedInference.includes(scope)) pinnedInference.push(scope);
  }
  return { inference, pinnedInference };
}

// Before Local Mode used OpenWhispr Cloud for uploads and cleanup with nothing saved, it kept both
// on this iPhone and ignored a Cloud choice saved for them, so a config from then that is in Local
// Mode keeps them there: the upgrade sends nothing to Cloud that was never sent before.
export function localModeUpgradeConfig(config: UserConfig): Partial<UserConfig> {
  if (config.defaultMode !== 'private') return { localModeUpgraded: true };
  return { localModeUpgraded: true, ...holdOnDeviceConfig(config) };
}
