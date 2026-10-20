const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Meeting keyterms come from the effective dictionary: personal words, then the
// active workspace's shared words. Hidden and paused words never reach
// sharedDictionaryHints (selectSharedHintWords), so they never reach a meeting.

async function prepareWithDictionary(t, { customDictionary, sharedDictionaryHints }) {
  const prepared = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        meetingTranscriptionPrepare: async (options) => {
          prepared.push(options);
          return { success: true };
        },
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-meeting-keyterms-test-",
  });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({
    meetingTranscriptionMode: "providers",
    meetingCloudTranscriptionProvider: "corti",
    customDictionary,
    sharedDictionaryHints,
  });
  const store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  await store.prepareTranscription();
  assert.equal(prepared.length, 1, "prepare must reach main");
  return prepared[0];
}

test("meeting keyterms include shared words, exclude hidden", async (t) => {
  // "Hidden" was hidden by the member, so it was never in the hints.
  const options = await prepareWithDictionary(t, {
    customDictionary: ["Piha", "OpenWhispr"],
    sharedDictionaryHints: { space: ["Openwhispr", "Qdrant"], workspace: ["ARR"] },
  });

  assert.deepEqual(options.keyterms, ["Piha", "OpenWhispr", "Qdrant", "ARR"]);
  assert.ok(!options.keyterms.includes("Hidden"));
});
