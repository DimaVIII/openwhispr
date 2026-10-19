jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { Platform } from 'react-native';
import {
  dictationModeConfig,
  getInferenceModes,
  holdOnDeviceConfig,
  localModeUpgradeConfig,
  workflowSaveConfig,
} from '../inferenceModes';
import type { UserConfig } from '@/types';

const groqCleanup = {
  mode: 'providers' as const,
  providerId: 'groq',
  modelId: 'llama-3.3-70b-versatile',
  credentialRef: 'provider.groq',
};
const groqDictation = {
  mode: 'providers' as const,
  providerId: 'groq',
  modelId: 'whisper-large-v3-turbo',
  credentialRef: 'provider.groq',
};

it('releases only the automatic pins when onboarding picks another mode', () => {
  const pinned: UserConfig = {
    defaultMode: 'providers',
    inference: {
      dictation: groqDictation,
      upload: { mode: 'local' },
      notes: { mode: 'local' },
      cleanup: { mode: 'local' },
    },
    pinnedInference: ['upload', 'notes'],
  };
  const next = dictationModeConfig(pinned, 'cloud');
  expect(next.inference).toEqual({ dictation: { mode: 'openwhispr' }, cleanup: { mode: 'local' } });
  expect(next.pinnedInference).toBeUndefined();
});

// Local Mode cleans On-Device whatever is saved for cleanup other than a provider, so switching
// keeps the user's cleanup choice for when Local Mode is off again.
it.each([
  ['On-Device', { mode: 'local' as const }],
  ['OpenWhispr Cloud', { mode: 'openwhispr' as const }],
  ['provider', groqCleanup],
])('keeps a saved %s cleanup when switching modes', (_label, cleanup) => {
  for (const mode of ['cloud', 'private'] as const) {
    const saved: UserConfig = {
      defaultMode: mode === 'cloud' ? 'private' : 'cloud',
      inference: { cleanup },
    };
    expect(dictationModeConfig(saved, mode).inference?.cleanup).toEqual(cleanup);
  }
});

// Picking another on-device model, or replaying Local Mode in onboarding, is not a mode change.
it('keeps the automatic pins when dictation is saved to the mode it is already in', () => {
  const held: UserConfig = {
    defaultMode: 'private',
    inference: { dictation: { mode: 'local' }, upload: { mode: 'local' } },
    pinnedInference: ['upload'],
  };
  const next = dictationModeConfig(held, 'private');
  expect(next.inference?.upload).toEqual({ mode: 'local' });
  expect(next).not.toHaveProperty('pinnedInference');
});

it('keeps an explicit On-Device upload choice when dictation leaves Bring Your Own Key', () => {
  const explicit: UserConfig = {
    defaultMode: 'providers',
    inference: { dictation: groqDictation, upload: { mode: 'local' } },
  };
  expect(dictationModeConfig(explicit, 'cloud').inference?.upload).toEqual({ mode: 'local' });
});

it('keeps an explicit upload choice when toggling between Cloud and On-Device', () => {
  const explicit = {
    defaultMode: 'cloud' as const,
    inference: { upload: { mode: 'local' as const } },
  };
  expect(dictationModeConfig(explicit, 'private').inference?.upload).toEqual({ mode: 'local' });
});

it('keeps the dictation selection in step with Local Mode', () => {
  const config = {
    defaultMode: 'private' as const,
    inference: {
      dictation: { mode: 'local' as const },
      upload: { mode: 'providers' as const, providerId: 'groq' },
    },
  };
  expect(dictationModeConfig(config, 'cloud')).toEqual({
    defaultMode: 'cloud',
    inference: { dictation: { mode: 'openwhispr' }, upload: config.inference.upload },
  });
  expect(dictationModeConfig(null, 'private')).toEqual({
    defaultMode: 'private',
    inference: { dictation: { mode: 'local' } },
  });
});

describe('workflowSaveConfig', () => {
  const local: UserConfig = { defaultMode: 'private', inference: { dictation: { mode: 'local' } } };
  const allSaved: UserConfig['inference'] = {
    upload: { mode: 'local' },
    cleanup: groqCleanup,
    notes: { mode: 'openwhispr' },
    agent: { mode: 'local' },
  };

  // Changing Dictation changes only dictation, from and to every mode.
  it.each([
    ['cloud', 'private', { mode: 'local' as const }],
    ['cloud', 'providers', groqDictation],
    ['private', 'cloud', { mode: 'openwhispr' as const }],
    ['private', 'providers', groqDictation],
    ['providers', 'cloud', { mode: 'openwhispr' as const }],
    ['providers', 'private', { mode: 'local' as const }],
  ] as const)(
    'leaves saved workflows alone when dictation moves from %s to %s',
    (from, to, dictation) => {
      const config: UserConfig = {
        defaultMode: from,
        inference: { dictation: { mode: 'openwhispr' }, ...allSaved },
        pinnedInference: ['upload', 'agent'],
      };
      const next = workflowSaveConfig(config, 'dictation', dictation, from, 'account', true);
      expect(next.defaultMode).toBe(to);
      expect(next.inference).toEqual({ ...allSaved, dictation });
      expect(next.pinnedInference).toEqual(['upload', 'agent']);
    },
  );

  it('holds unsaved workflows on Cloud when dictation leaves Cloud', () => {
    const next = workflowSaveConfig({ defaultMode: 'cloud' }, 'dictation', groqDictation, 'cloud');
    expect(next.inference).toEqual({
      dictation: groqDictation,
      upload: { mode: 'openwhispr' },
      cleanup: { mode: 'openwhispr' },
      notes: { mode: 'openwhispr' },
      agent: { mode: 'openwhispr' },
    });
    expect(next.pinnedInference).toEqual(['upload', 'cleanup', 'notes', 'agent']);
  });

  // Unsaved cleanup and voice assistant were skipped under Bring Your Own Key, so there is nothing
  // to hold; uploads and notes ran on Cloud.
  it('holds only what ran when dictation leaves Bring Your Own Key', () => {
    const config: UserConfig = {
      defaultMode: 'providers',
      inference: { dictation: groqDictation },
    };
    const next = workflowSaveConfig(config, 'dictation', { mode: 'openwhispr' }, 'providers');
    expect(next).toEqual({
      defaultMode: 'cloud',
      inference: {
        dictation: { mode: 'openwhispr' },
        upload: { mode: 'openwhispr' },
        notes: { mode: 'openwhispr' },
      },
      pinnedInference: ['upload', 'notes'],
    });
  });

  describe('leaving Local Mode', () => {
    it.each(['cloud', 'providers'] as const)(
      'holds what ran on this phone without a session when going to %s',
      (to) => {
        const dictation = to === 'cloud' ? { mode: 'openwhispr' as const } : groqDictation;
        const next = workflowSaveConfig(local, 'dictation', dictation, 'private', 'none', true);
        expect(next.inference).toEqual({
          dictation,
          upload: { mode: 'local' },
          cleanup: { mode: 'local' },
          notes: { mode: 'local' },
        });
        expect(next.pinnedInference).toEqual(['upload', 'cleanup', 'notes']);
      },
    );

    // Local Mode used OpenWhispr Cloud for uploads with a session, and for cleanup with an account.
    it.each([
      ['session', 'openwhispr', 'local'],
      ['account', 'openwhispr', 'openwhispr'],
    ] as const)(
      'holds uploads and cleanup where they ran with %s access',
      (access, upload, cleanup) => {
        const next = workflowSaveConfig(
          local,
          'dictation',
          { mode: 'openwhispr' },
          'private',
          access,
        );
        expect(next.inference?.upload).toEqual({ mode: upload });
        expect(next.inference?.cleanup).toEqual({ mode: cleanup });
      },
    );

    // Saved On-Device notes never fall back to Cloud; Local Mode asked before using it instead.
    it('holds notes on Cloud when Apple Intelligence cannot run them', () => {
      const next = workflowSaveConfig(local, 'dictation', { mode: 'openwhispr' }, 'private');
      expect(next.inference?.notes).toEqual({ mode: 'openwhispr' });
    });

    it('holds the on-device model picked for a workflow', () => {
      const whisper = { mode: 'local' as const, modelId: 'whisper-base' };
      const config: UserConfig = { ...local, rememberedInference: { upload: { local: whisper } } };
      const next = workflowSaveConfig(config, 'dictation', { mode: 'openwhispr' }, 'private');
      expect(next.inference?.upload).toEqual(whisper);
    });
  });

  it('turns Local Mode on with the model picked on the Dictation page', () => {
    const whisper = { mode: 'local' as const, modelId: 'whisper-base' };
    const config: UserConfig = {
      defaultMode: 'cloud',
      rememberedInference: { dictation: { local: whisper } },
    };
    const next = workflowSaveConfig(config, 'dictation', { mode: 'local' }, 'cloud');
    expect(next.inference?.dictation).toEqual(whisper);
  });

  it('holds nothing when dictation is saved to the mode it is already in', () => {
    const config: UserConfig = {
      defaultMode: 'providers',
      inference: { dictation: groqDictation, upload: { mode: 'local' } },
      pinnedInference: ['upload'],
    };
    const openai = { ...groqDictation, providerId: 'openai', modelId: 'whisper-1' };
    const next = workflowSaveConfig(config, 'dictation', openai, 'providers');
    expect(next.inference).toEqual({ dictation: openai, upload: { mode: 'local' } });
    expect(next).not.toHaveProperty('pinnedInference');
  });

  it('makes a pinned workflow explicit once the user saves it', () => {
    const config: UserConfig = {
      defaultMode: 'providers',
      inference: { dictation: groqDictation, upload: { mode: 'local' } },
      pinnedInference: ['upload', 'notes'],
    };
    const next = workflowSaveConfig(config, 'upload', { mode: 'local' }, 'providers');
    expect(next.pinnedInference).toEqual(['notes']);
    expect(next.defaultMode).toBeUndefined();
    expect(dictationModeConfig({ ...config, ...next }, 'cloud').inference?.upload).toEqual({
      mode: 'local',
    });
  });

  it('remembers the provider saved last so switching back restores it', () => {
    const config: UserConfig = {
      defaultMode: 'cloud',
      rememberedInference: {
        cleanup: {
          groq: { mode: 'providers', providerId: 'groq', modelId: 'old-model' },
          openai: { mode: 'providers', providerId: 'openai', modelId: 'gpt-4o-mini' },
        },
      },
    };
    const openai = { mode: 'providers' as const, providerId: 'openai', modelId: 'gpt-4.1' };
    const next = workflowSaveConfig(config, 'cleanup', openai, 'cloud');
    expect(Object.keys(next.rememberedInference?.cleanup ?? {})).toEqual(['openai', 'groq']);
    expect(next.rememberedInference?.cleanup?.openai).toEqual(openai);
  });

  it('keeps the voice assistant skipped through a round trip in Local Mode', () => {
    const providers: UserConfig = {
      defaultMode: 'providers',
      inference: { dictation: groqDictation },
    };
    const on = {
      ...providers,
      ...workflowSaveConfig(providers, 'dictation', { mode: 'local' }, 'providers'),
    };
    const off = { ...on, ...workflowSaveConfig(on, 'dictation', groqDictation, 'private') };
    expect(off.defaultMode).toBe('providers');
    // Skipped cleanup has no selection to hold, so it keeps the on-device cleanup Local Mode ran.
    expect(off.inference).toEqual({
      dictation: groqDictation,
      upload: { mode: 'openwhispr' },
      cleanup: { mode: 'local' },
      notes: { mode: 'openwhispr' },
    });
  });

  // Local Mode cleaned on Cloud for an account, so that is what leaving it holds, even for a
  // cleanup Bring Your Own Key skipped before Local Mode was turned on.
  it('holds cleanup on Cloud when an account leaves Local Mode for Bring Your Own Key', () => {
    const providers: UserConfig = {
      defaultMode: 'providers',
      inference: { dictation: groqDictation },
    };
    const on = {
      ...providers,
      ...workflowSaveConfig(providers, 'dictation', { mode: 'local' }, 'providers', 'account'),
    };
    const off = {
      ...on,
      ...workflowSaveConfig(on, 'dictation', groqDictation, 'private', 'account'),
    };
    expect(off.inference?.cleanup).toEqual({ mode: 'openwhispr' });
    expect(off.inference).not.toHaveProperty('agent');
  });

  // Setup in Local Mode holds only uploads and cleanup; the voice assistant is off there, so a
  // later switch to Bring Your Own Key leaves it skipped rather than sending it to Cloud.
  it('leaves the voice assistant unsaved when Local setup is followed by Bring Your Own Key', () => {
    const setup = dictationModeConfig({ defaultMode: 'cloud' }, 'private');
    const local: UserConfig = { ...setup, ...holdOnDeviceConfig(setup) };
    const next = workflowSaveConfig(local, 'dictation', groqDictation, 'private', 'session', true);
    expect(next.inference).toEqual({
      dictation: groqDictation,
      upload: { mode: 'local' },
      cleanup: { mode: 'local' },
      notes: { mode: 'local' },
    });
    expect(next.pinnedInference).toEqual(['upload', 'cleanup', 'notes']);
  });

  // Cloud cleanup held for an anonymous session can't run in Local Mode, which cleans on this
  // phone instead (workflowSelection); returning to Cloud finds it on Cloud again.
  it('ends a Cloud round trip through Local Mode on Cloud for an anonymous session', () => {
    const cloud: UserConfig = {
      defaultMode: 'cloud',
      inference: { dictation: { mode: 'openwhispr' } },
    };
    const on = {
      ...cloud,
      ...workflowSaveConfig(cloud, 'dictation', { mode: 'local' }, 'cloud', 'session'),
    };
    expect(on.inference?.cleanup).toEqual({ mode: 'openwhispr' });
    expect(on.pinnedInference).toContain('cleanup');
    const off = {
      ...on,
      ...workflowSaveConfig(on, 'dictation', { mode: 'openwhispr' }, 'private', 'session'),
    };
    expect(off.inference).toEqual({
      dictation: { mode: 'openwhispr' },
      upload: { mode: 'openwhispr' },
      cleanup: { mode: 'openwhispr' },
      notes: { mode: 'openwhispr' },
      agent: { mode: 'openwhispr' },
    });
  });
});

// Before Local Mode's Cloud defaults, it kept uploads and cleanup on this phone and ignored a Cloud
// choice saved for them.
describe('localModeUpgradeConfig', () => {
  it('holds uploads and cleanup on this phone for a config in Local Mode', () => {
    const config: UserConfig = {
      defaultMode: 'private',
      inference: { dictation: { mode: 'local' }, cleanup: { mode: 'openwhispr' } },
      rememberedInference: { upload: { local: { mode: 'local', modelId: 'whisper-base' } } },
    };
    expect(localModeUpgradeConfig(config)).toEqual({
      localModeUpgraded: true,
      inference: {
        dictation: { mode: 'local' },
        upload: { mode: 'local', modelId: 'whisper-base' },
        cleanup: { mode: 'local' },
      },
      pinnedInference: ['upload', 'cleanup'],
    });
  });

  it('keeps an On-Device or provider choice the user saved', () => {
    const config: UserConfig = {
      defaultMode: 'private',
      inference: { upload: { mode: 'local', modelId: 'whisper-base' }, cleanup: groqCleanup },
    };
    expect(localModeUpgradeConfig(config)).toEqual({
      localModeUpgraded: true,
      inference: config.inference,
      pinnedInference: [],
    });
  });

  it.each(['cloud', 'providers'] as const)('only marks a config in %s mode', (defaultMode) => {
    expect(localModeUpgradeConfig({ defaultMode })).toEqual({ localModeUpgraded: true });
  });

  it('is kept when dictation leaves Local Mode', () => {
    const config: UserConfig = {
      defaultMode: 'private',
      inference: { dictation: { mode: 'local' } },
    };
    const upgraded = { ...config, ...localModeUpgradeConfig(config) };
    const next = workflowSaveConfig(
      upgraded,
      'dictation',
      { mode: 'openwhispr' },
      'private',
      'account',
    );
    expect(next.inference?.upload).toEqual({ mode: 'local' });
    expect(next.inference?.cleanup).toEqual({ mode: 'local' });
  });
});

describe('getInferenceModes', () => {
  afterEach(() => {
    Platform.OS = 'ios';
  });

  it('offers Bring Your Own Key on iOS', () => {
    expect(getInferenceModes('text').map((mode) => mode.mode)).toContain('providers');
  });

  it('never offers Bring Your Own Key on Android', () => {
    Platform.OS = 'android';
    expect(getInferenceModes('speech').map((mode) => mode.mode)).toEqual(['openwhispr', 'local']);
  });
});

it('switches dictation back to On-Device with the model the user picked', () => {
  const config = {
    defaultMode: 'cloud' as const,
    inference: { dictation: { mode: 'openwhispr' as const } },
    rememberedInference: {
      dictation: { local: { mode: 'local' as const, modelId: 'parakeet-v3' } },
    },
  };
  expect(dictationModeConfig(config, 'private').inference?.dictation).toEqual({
    mode: 'local',
    modelId: 'parakeet-v3',
  });
});
