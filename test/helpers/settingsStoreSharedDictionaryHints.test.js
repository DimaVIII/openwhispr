const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Persisted shared hints carry the workspace they were built for, and apply
// only while that workspace is active: the key is shared between windows and
// survives restarts, so another workspace's (or account's) words must never
// reach the prompt.

const WS_A = "workspace-a";
const WS_B = "workspace-b";
const EMPTY = { space: [], workspace: [] };

const persisted = (workspaceId, space = ["Kube"], workspace = ["Acme"]) =>
  JSON.stringify({ workspaceId, space, workspace });

async function loadStore(t, { initialStorage, cachePrefix, electronAPI = {} }) {
  const listeners = [];
  const { storage } = installBrowserGlobals(t, {
    // The agent name already in the dictionary keeps initializeSettings from
    // writing it, which would start a cloud sync after the test ends.
    initialStorage: { customDictionary: '["OpenWhispr"]', ...initialStorage },
    window: {
      addEventListener: (type, listener) => {
        if (type === "storage") listeners.push(listener);
      },
      electronAPI: {
        getOpenAIKey: async () => "",
        setDictionary: async () => {},
        ...electronAPI,
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix });
  const settings = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const fireStorage = (key, newValue) => {
    for (const listener of listeners) {
      listener({ key, newValue, storageArea: globalThis.localStorage });
    }
  };
  return { ...settings, storage, vite, fireStorage };
}

async function initialize(loaded) {
  try {
    await loaded.initializeSettings();
  } finally {
    const { default: i18n } = await loaded.vite.ssrLoadModule("/i18n.ts");
    await i18n.changeLanguage("en");
  }
}

test("persisted hints for the active workspace apply at init", async (t) => {
  const { useSettingsStore } = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-match-",
    initialStorage: { activeWorkspaceId: WS_A, sharedDictionaryHints: persisted(WS_A) },
  });

  assert.deepEqual(useSettingsStore.getState().sharedDictionaryHints, {
    space: ["Kube"],
    workspace: ["Acme"],
  });
});

test("persisted hints for another workspace are empty at init", async (t) => {
  const { useSettingsStore } = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-mismatch-",
    initialStorage: { activeWorkspaceId: WS_B, sharedDictionaryHints: persisted(WS_A) },
  });

  assert.deepEqual(useSettingsStore.getState().sharedDictionaryHints, EMPTY);
});

test("persisted hints with no active workspace are empty at init", async (t) => {
  const { useSettingsStore } = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-no-workspace-",
    initialStorage: { sharedDictionaryHints: persisted(WS_A) },
  });

  assert.deepEqual(useSettingsStore.getState().sharedDictionaryHints, EMPTY);
});

test("malformed persisted hints are empty at init", async (t) => {
  for (const [index, raw] of [
    "not json",
    "null",
    JSON.stringify({ space: ["Kube"], workspace: ["Acme"] }), // no workspace id
    JSON.stringify({ workspaceId: 7, space: ["Kube"], workspace: ["Acme"] }),
    JSON.stringify({ workspaceId: WS_A, space: "Kube", workspace: [] }),
  ].entries()) {
    const { useSettingsStore } = await loadStore(t, {
      cachePrefix: `openwhispr-shared-hints-malformed-${index}-`,
      initialStorage: { activeWorkspaceId: WS_A, sharedDictionaryHints: raw },
    });
    assert.deepEqual(useSettingsStore.getState().sharedDictionaryHints, EMPTY, raw);
  }
});

test("the setter persists the workspace and sends main only the hints", async (t) => {
  const sent = [];
  const loaded = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-setter-",
    initialStorage: { activeWorkspaceId: WS_A },
    electronAPI: {
      setSharedDictionaryHints: async (hints) => {
        sent.push(hints);
      },
    },
  });
  await initialize(loaded);
  assert.deepEqual(sent, [EMPTY], "init primes main with the persisted (empty) hints");

  const hints = { space: ["Kube"], workspace: ["Acme"] };
  loaded.useSettingsStore.getState().setSharedDictionaryHints(hints, WS_A);

  assert.deepEqual(JSON.parse(loaded.storage.getItem("sharedDictionaryHints")), {
    workspaceId: WS_A,
    ...hints,
  });
  assert.deepEqual(loaded.useSettingsStore.getState().sharedDictionaryHints, hints);
  assert.deepEqual(sent.at(-1), hints);
});

test("another window's hints apply only for the active workspace", async (t) => {
  const loaded = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-storage-",
    initialStorage: { activeWorkspaceId: WS_A },
  });
  await initialize(loaded);
  const current = () => loaded.useSettingsStore.getState().sharedDictionaryHints;

  loaded.fireStorage("sharedDictionaryHints", persisted(WS_A));
  assert.deepEqual(current(), { space: ["Kube"], workspace: ["Acme"] });

  loaded.fireStorage("sharedDictionaryHints", persisted(WS_B, ["Other"]));
  assert.deepEqual(current(), EMPTY);
});

test("a workspace switch in another window empties the hints", async (t) => {
  const loaded = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-switch-",
    initialStorage: { activeWorkspaceId: WS_A, sharedDictionaryHints: persisted(WS_A) },
  });
  await initialize(loaded);
  assert.notDeepEqual(loaded.useSettingsStore.getState().sharedDictionaryHints, EMPTY);

  loaded.storage.setItem("activeWorkspaceId", WS_B);
  loaded.fireStorage("activeWorkspaceId", WS_B);

  assert.deepEqual(loaded.useSettingsStore.getState().sharedDictionaryHints, EMPTY);
});

test("a full localStorage still publishes the hints and drops the stale copy", async (t) => {
  const sent = [];
  const loaded = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-quota-",
    initialStorage: { activeWorkspaceId: WS_A, sharedDictionaryHints: persisted(WS_A, ["Old"]) },
    electronAPI: {
      setSharedDictionaryHints: async (hints) => {
        sent.push(hints);
      },
    },
  });
  await initialize(loaded);
  t.mock.method(console, "warn", () => {});
  const setItem = loaded.storage.setItem;
  loaded.storage.setItem = (key, value) => {
    if (key === "sharedDictionaryHints") throw new Error("QuotaExceededError");
    return setItem(key, value);
  };

  const hints = { space: [], workspace: ["Acme"] };
  assert.doesNotThrow(() =>
    loaded.useSettingsStore.getState().setSharedDictionaryHints(hints, WS_A)
  );

  assert.deepEqual(loaded.useSettingsStore.getState().sharedDictionaryHints, hints);
  assert.deepEqual(sent.at(-1), hints);
  assert.equal(loaded.storage.getItem("sharedDictionaryHints"), null);
});

test("persisted hints keep the moved words a hide suppresses", async (t) => {
  const { useSettingsStore } = await loadStore(t, {
    cachePrefix: "openwhispr-shared-hints-suppressed-",
    initialStorage: {
      activeWorkspaceId: WS_A,
      sharedDictionaryHints: JSON.stringify({
        workspaceId: WS_A,
        space: [],
        workspace: ["Acme"],
        suppressedPersonal: ["Kube", 7],
      }),
    },
  });

  assert.deepEqual(useSettingsStore.getState().sharedDictionaryHints, {
    space: [],
    workspace: ["Acme"],
    suppressedPersonal: ["Kube"],
  });
});
