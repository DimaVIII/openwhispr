const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");

const { createElement } = React;
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { findElement, installInteractiveDom } = require("../lib/interactiveDom");

const ENGINEERING = "11111111-1111-4111-8111-111111111111";
const SALES = "22222222-2222-4222-8222-222222222222";

const MOCKS = {
  "react-i18next": `
    const t = (key, options) => (options ? key + JSON.stringify(options) : key);
    export const useTranslation = () => ({ t, i18n: { language: "en" } });
  `,
  "/hooks/useSettings": `
    export function useSettings() { return globalThis.__settings; }
  `,
  "/hooks/useWorkspace": `
    export function useWorkspace() {
      const active = globalThis.__workspace;
      return { active, role: active?.role ?? null, workspaces: active ? [active] : [] };
    }
  `,
  "/hooks/useAuth": `
    export function useAuth() { return { isSignedIn: true, user: { id: "u-me" } }; }
  `,
  "/utils/agentName": `
    export const getAgentName = () => "Whispr";
  `,
  "/stores/sharedDictionaryStore": `
    export function useSharedDictionaryStore(selector) { return selector(globalThis.__shared); }
    useSharedDictionaryStore.getState = () => globalThis.__shared;
  `,
  "/services/sharedDictionaryActions": `
    const record = (name) => async (...args) => {
      globalThis.__calls.push([name, ...args]);
      return globalThis.__results?.[name];
    };
    export class SharedDictionaryActionError extends Error {}
    export const addSharedWords = record("addSharedWords");
    export const editSharedWord = record("editSharedWord");
    export const deleteSharedWords = record("deleteSharedWords");
    export const setSharedWordsHidden = record("setSharedWordsHidden");
  `,
  "/services/SyncService": `
    export const syncService = {
      syncSharedDictionaryNow: async () => { globalThis.__calls.push(["syncShared"]); },
      syncDictionaryNow: async () => { globalThis.__calls.push(["syncPersonal"]); },
    };
  `,
  "/ui/dropdown-menu": `
    import { createElement } from "react";
    export const DropdownMenu = ({ children }) => children;
    export const DropdownMenuTrigger = ({ children }) => children;
    export const DropdownMenuContent = ({ children }) => createElement("div", null, children);
    export const DropdownMenuItem = ({ children, onSelect }) =>
      createElement("button", { onClick: onSelect, "data-menu-item": "" }, children);
    export const DropdownMenuSeparator = () => null;
  `,
  // Radix Tabs and Dialog measure styles this DOM doesn't implement.
  "/ui/tabs": `
    import { createElement } from "react";
    const Pass = ({ children }) => createElement("div", null, children);
    export const Tabs = Pass;
    export const TabsList = Pass;
    export const TabsTrigger = Pass;
    export const TabsContent = ({ children, value }) =>
      value === "dictionary" ? createElement("div", null, children) : null;
  `,
  "/ui/dialog": `
    export const ConfirmDialog = () => null;
  `,
  "/ui/useToast": `
    export const useToast = () => ({ toast: (props) => { globalThis.__toasts.push(props); return "id"; } });
  `,
  "/SnippetsView": `
    export default function SnippetsView() { return null; }
  `,
  "/DictionaryEmptyIllustration": `
    export default function DictionaryEmptyIllustration() { return null; }
  `,
};

const entry = (cloudId, word, spaceId, addedByUserId = "u-ana", createdAt = "2026-10-01") => ({
  cloudId,
  spaceId,
  word,
  addedByUserId,
  createdAt: `${createdAt}T00:00:00.000Z`,
  updatedAt: `${createdAt}T00:00:00.000Z`,
});

const SNAPSHOT = {
  entries: [
    entry("e-arr", "ARR", null),
    entry("e-k8s", "Kubernetes", null),
    entry("e-qdrant", "Qdrant", ENGINEERING),
    entry("e-sherpa", "sherpa-onnx", ENGINEERING, "u-me"),
    entry("e-meddicc", "MEDDICC", SALES),
  ],
  hiddenIds: [],
  meta: {
    scopes: [
      { space_id: null, name: "Acme", member_count: 20, word_count: 2 },
      { space_id: ENGINEERING, name: "Engineering", member_count: 14, word_count: 2 },
      { space_id: SALES, name: "Sales", member_count: 5, word_count: 1 },
    ],
    contributors: [{ user_id: "u-ana", name: "Ana", is_member: true }],
    paused: false,
    syncedAt: "2026-10-20T10:00:00.000Z",
  },
};

function setState(t, { initialStorage = {} } = {}) {
  const calls = [];
  globalThis.__calls = calls;
  globalThis.__toasts = [];
  globalThis.__results = { deleteSharedWords: { undo: async () => {} } };
  globalThis.__settings = {
    customDictionary: ["OpenWhispr", "Supabase", "Whispr"],
    updateCustomDictionary: (changes) => calls.push(["updateCustomDictionary", changes]),
    snippets: [],
  };
  globalThis.__workspace = {
    id: "ws",
    name: "Acme",
    plan: "business",
    status: "active",
    role: "member",
  };
  globalThis.__shared = {
    status: "ready",
    snapshot: SNAPSHOT,
    movedPersonal: [],
    syncing: false,
    lastSyncedAt: SNAPSHOT.meta.syncedAt,
    requestedList: null,
    setRequestedList: (list) => {
      globalThis.__shared.requestedList = list;
    },
    reload: async () => {
      calls.push(["reload"]);
    },
  };
  t.after(() => {
    for (const key of [
      "__calls",
      "__toasts",
      "__results",
      "__settings",
      "__workspace",
      "__shared",
    ]) {
      delete globalThis[key];
    }
  });
  return { calls, initialStorage };
}

async function renderView(t, options = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const { calls, initialStorage } = setState(t, options);
  const { storage } = installBrowserGlobals(t, { initialStorage });
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-dictionary-view-test-",
    noExternal: ["react-i18next"],
    mockModules: MOCKS,
  });
  const { default: DictionaryView } = await vite.ssrLoadModule("/components/DictionaryView.tsx");
  root = createRoot(container);
  await React.act(async () => root.render(createElement(DictionaryView)));
  return { container, calls, storage };
}

const click = (element) =>
  React.act(async () => element.dispatchEvent({ type: "click", bubbles: true }));

const pickerEntry = (container, key) =>
  findElement(container, (node) => node.getAttribute?.("data-list-key") === key);

const rowFor = (container, word) =>
  findElement(
    container,
    (node) => node.tagName === "LI" && node.getAttribute("data-word") === word
  );

const buttonsIn = (node) => node.querySelectorAll("button");

const openList = async (container, key) => {
  const button = pickerEntry(container, key);
  assert.ok(button, `picker entry ${key} exists`);
  await click(button);
};

test("renders picker entries with counts", async (t) => {
  const { container, calls } = await renderView(t);
  const expected = {
    all: ["dictionary.shared.allWords", "7"],
    personal: ["dictionary.shared.personal", "2"],
    allShared: ["dictionary.shared.allShared", "5"],
    workspace: ['dictionary.shared.everyoneAt{"workspace":"Acme"}', "2"],
    [`space:${ENGINEERING}`]: ["Engineering", "2"],
    [`space:${SALES}`]: ["Sales", "1"],
    hidden: ["dictionary.shared.hidden", "0"],
  };
  for (const [key, [label, count]] of Object.entries(expected)) {
    const button = pickerEntry(container, key);
    assert.ok(button, `picker entry ${key} exists`);
    assert.equal(button.textContent, `${label}${count}`);
  }
  assert.ok(container.textContent.includes("dictionary.shared.group"));
  // The page's snapshot is reread on mount: another window may have run the last pass.
  assert.ok(calls.some(([name]) => name === "reload"));
});

test("the Shared group is not rendered while the feature is unavailable", async (t) => {
  const { container } = await renderView(t);
  globalThis.__shared.status = "unavailable";
  await openList(container, "personal");
  assert.equal(pickerEntry(container, "allShared"), null);
  assert.equal(pickerEntry(container, "hidden"), null);
  assert.ok(pickerEntry(container, "all"));
  assert.ok(!container.textContent.includes("dictionary.shared.group"));
});

test("mixed view shows list badges", async (t) => {
  const { container } = await renderView(t);
  await openList(container, "allShared");
  assert.match(rowFor(container, "Qdrant").textContent, /^QdrantEngineering/);
  assert.match(rowFor(container, "ARR").textContent, /^ARRAcme/);
  assert.match(rowFor(container, "MEDDICC").textContent, /^MEDDICCSales/);

  // A single list shows who added each word instead.
  await openList(container, `space:${ENGINEERING}`);
  assert.match(rowFor(container, "Qdrant").textContent, /^QdrantAna/);
  assert.match(
    rowFor(container, "sherpa-onnx").textContent,
    /dictionary\.shared\.attribution\.you/
  );
});

test("shared row hover exposes Edit, Hide for me and Delete for everyone by aria-label", async (t) => {
  const { container, calls } = await renderView(t);
  await openList(container, `space:${ENGINEERING}`);
  const labels = buttonsIn(rowFor(container, "Qdrant")).map((button) =>
    button.getAttribute("aria-label")
  );
  assert.deepEqual(labels, [
    "dictionary.shared.actions.edit",
    "dictionary.shared.actions.hide",
    "dictionary.shared.actions.deleteForEveryone",
  ]);

  const hide = buttonsIn(rowFor(container, "Qdrant"))[1];
  await click(hide);
  assert.deepEqual(
    calls.find(([name]) => name === "setSharedWordsHidden"),
    ["setSharedWordsHidden", "ws", ["e-qdrant"], true]
  );

  const remove = buttonsIn(rowFor(container, "Qdrant"))[2];
  await click(remove);
  assert.deepEqual(
    calls.find(([name]) => name === "deleteSharedWords"),
    ["deleteSharedWords", "ws", ["e-qdrant"]]
  );
  // Delete for everyone offers an Undo.
  assert.equal(globalThis.__toasts.at(-1).actions[0].label, "dictionary.shared.undo");
});

test("personal and hidden rows have their own hover actions", async (t) => {
  const { container } = await renderView(t);
  await openList(container, "personal");
  // Share comes with the share popover; the row keeps Edit and Delete.
  assert.deepEqual(
    buttonsIn(rowFor(container, "OpenWhispr")).map((button) => button.getAttribute("aria-label")),
    ["dictionary.shared.actions.edit", "dictionary.shared.actions.delete"]
  );

  globalThis.__shared.snapshot = { ...SNAPSHOT, hiddenIds: ["e-arr"] };
  await openList(container, "hidden");
  assert.deepEqual(
    buttonsIn(rowFor(container, "ARR")).map((button) => button.getAttribute("aria-label")),
    ["dictionary.shared.actions.unhide"]
  );
});

const targetChip = (container) =>
  findElement(
    container,
    (node) =>
      node.tagName === "BUTTON" &&
      node.getAttribute("aria-label") === "dictionary.shared.add.chooseList"
  );

test("add target defaults to the open list", async (t) => {
  const { container, storage } = await renderView(t, {
    initialStorage: { dictionaryAddTarget: JSON.stringify(SALES) },
  });
  await openList(container, `space:${ENGINEERING}`);
  assert.equal(targetChip(container).textContent, 'dictionary.shared.add.to{"list":"Engineering"}');

  await openList(container, "workspace");
  assert.equal(
    targetChip(container).textContent,
    'dictionary.shared.add.to{"list":"dictionary.shared.everyoneAt{\\"workspace\\":\\"Acme\\"}"}'
  );

  await openList(container, "personal");
  assert.equal(
    targetChip(container).textContent,
    'dictionary.shared.add.to{"list":"dictionary.shared.personal"}'
  );

  // Mixed views fall back to the list last used.
  await openList(container, "all");
  assert.equal(targetChip(container).textContent, 'dictionary.shared.add.to{"list":"Sales"}');

  // Picking a list remembers it.
  const engineering = findElement(
    container,
    (node) => node.getAttribute?.("data-menu-item") === "" && node.textContent === "Engineering"
  );
  await click(engineering);
  assert.equal(storage.getItem("dictionaryAddTarget"), JSON.stringify(ENGINEERING));
  assert.equal(targetChip(container).textContent, 'dictionary.shared.add.to{"list":"Engineering"}');
});

test("sort choice persists to localStorage", async (t) => {
  const { container, storage } = await renderView(t, {
    initialStorage: { dictionarySort: "za" },
  });
  await openList(container, "personal");
  const words = () =>
    container
      .querySelectorAll("li")
      .map((node) => node.getAttribute("data-word"))
      .filter(Boolean);
  assert.deepEqual(words(), ["Supabase", "OpenWhispr"]);

  const az = findElement(
    container,
    (node) =>
      node.getAttribute?.("data-menu-item") === "" &&
      node.textContent === "dictionary.shared.sort.az"
  );
  await click(az);
  assert.equal(storage.getItem("dictionarySort"), "az");
  assert.deepEqual(words(), ["OpenWhispr", "Supabase"]);
});
