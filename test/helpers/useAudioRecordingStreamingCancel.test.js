const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// A streaming voice-assistant recording in progress. Its stop and cancel
// report state the way the real AudioManager does: a stop stays processing
// until the transcript is handled, and a cancel reports a transient
// processing state while it tears the stream down, then idle.
const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  constructor() {
    this.voiceAgentRequested = true;
    this.translationRequested = false;
    this.sttConfig = { success: true };
    this.callbacks = {};
    globalThis.__streamingCancelAudioManager = this;
  }
  getState() {
    return { isRecording: true, isStreaming: true };
  }
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }
  setVoiceAgentRequested(value) {
    this.voiceAgentRequested = value;
  }
  setAssistantSelectionContext() {}
  setTranslationRequested(value) {
    this.translationRequested = value;
  }
  shouldUseStreaming() {
    return true;
  }
  isSttConfigStale() {
    return false;
  }
  prepareMicCapture() {}
  cancelPreparedMicCapture() {}
  cleanup() {}
  getRecordingAudioLevel() {
    return null;
  }
  report(state) {
    this.callbacks.onStateChange?.(state);
  }
  async stopStreamingRecording() {
    this.report({ isRecording: false, isProcessing: true, isStreaming: false });
    return true;
  }
  async cancelStreamingRecording() {
    this.report({ isRecording: false, isProcessing: true, isStreaming: false });
    // Held open the way a real provider disconnect keeps the cancel pending.
    await new Promise((resolve) => {
      this.finishCancel = resolve;
    });
    this.report({ isRecording: false, isProcessing: false, isStreaming: false });
    return true;
  }
}
`;

async function renderStreamingAssistantRecording(t) {
  // Registered before the DOM helpers so it runs while window/document exist.
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });

  const noopDispose = () => () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noopDispose,
        onToggleVoiceAgent: noopDispose,
        onToggleTranslation: noopDispose,
        onStartDictation: noopDispose,
        onPrepareDictation: noopDispose,
        onCancelDictationPreparation: noopDispose,
        onStopDictation: noopDispose,
      },
    },
  });
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  t.after(() => {
    delete globalThis.__streamingCancelAudioManager;
  });

  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-audio-recording-streaming-cancel-",
    mockModules: {
      "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE,
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { shouldBeginAssistantFollowUpThinking } = await vite.ssrLoadModule(
    "/helpers/voicePillPresentation.js"
  );

  // Every committed render, judged the way App.jsx decides whether an open
  // panel starts thinking for a follow-up voice command.
  const thinkingStarts = [];
  const api = {};
  // Stable, or every render would rebuild the AudioManager in the mount effect.
  const toast = () => {};
  const options = { onDemoEvent: () => {} };
  function Harness() {
    const recording = useAudioRecording(toast, options);
    Object.assign(api, recording);
    React.useEffect(() => {
      if (
        shouldBeginAssistantFollowUpThinking({
          isAssistantVoice: recording.isAssistantVoice,
          isProcessing: recording.isProcessing,
          isCancelling: recording.isCancelling,
          panelOpen: true,
        })
      ) {
        thinkingStarts.push(recording.isProcessing);
      }
    });
    return null;
  }

  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Harness));
  });
  await React.act(async () => {
    globalThis.__streamingCancelAudioManager.report({
      isRecording: true,
      isProcessing: false,
      isStreaming: true,
    });
  });
  assert.equal(api.isRecording, true);
  assert.equal(api.isAssistantVoice, true);

  return { api, thinkingStarts };
}

test("cancelling a streaming voice-assistant follow-up never starts the open panel's thinking", async (t) => {
  const { api, thinkingStarts } = await renderStreamingAssistantRecording(t);

  let cancelled;
  await React.act(async () => {
    cancelled = api.cancelRecording();
  });
  assert.equal(api.isProcessing, true);
  assert.deepEqual(thinkingStarts, []);
  assert.equal(api.isCancelling, true);

  await React.act(async () => {
    globalThis.__streamingCancelAudioManager.finishCancel();
    await cancelled;
  });

  assert.deepEqual(thinkingStarts, []);
  assert.equal(api.isProcessing, false);
  assert.equal(api.isCancelling, false);
});

test("stopping a streaming voice-assistant follow-up still starts the open panel's thinking", async (t) => {
  const { api, thinkingStarts } = await renderStreamingAssistantRecording(t);

  await React.act(async () => {
    await api.stopRecording();
  });

  assert.ok(thinkingStarts.length > 0);
  assert.equal(api.isProcessing, true);
  assert.equal(api.isCancelling, false);
});
