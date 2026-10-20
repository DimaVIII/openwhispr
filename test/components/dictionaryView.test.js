const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");

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
    export class SharedDictionaryActionError extends Error {
      constructor(reason) {
        super(reason);
        this.reason = reason;
      }
    }
    // A result of "throw:<reason>" makes the call fail with that reason.
    const record = (name) => async (...args) => {
      globalThis.__calls.push([name, ...args]);
      const result = globalThis.__results?.[name];
      if (typeof result === "string" && result.startsWith("throw:")) {
        throw new SharedDictionaryActionError(result.slice("throw:".length));
      }
      return result;
    };
    export const addSharedWords = record("addSharedWords");
    export const editSharedWord = record("editSharedWord");
    export const deleteSharedWords = record("deleteSharedWords");
    export const setSharedWordsHidden = record("setSharedWordsHidden");
    export const sharePersonalWords = record("sharePersonalWords");
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
    import { createElement } from "react";
    export const ConfirmDialog = ({ open, title, onConfirm, onOpenChange }) =>
      open
        ? createElement(
            "div",
            { "data-dialog": title },
            createElement("button", {
              "data-confirm": "",
              onClick: () => {
                onConfirm();
                onOpenChange(false);
              },
            }),
            createElement("button", { "data-cancel": "", onClick: () => onOpenChange(false) })
          )
        : null;
  `,
  // Radix positions the content with layout this DOM doesn't implement.
  "/ui/popover": `
    import { createElement } from "react";
    export const Popover = ({ open, children }) => (open ? children : null);
    export const PopoverAnchor = () => null;
    export const PopoverContent = ({ children }) => createElement("div", { "data-popover": "" }, children);
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

function setState(t, { initialStorage = {}, shared = {}, settings = {} } = {}) {
  const calls = [];
  globalThis.__calls = calls;
  globalThis.__toasts = [];
  globalThis.__results = { deleteSharedWords: { undo: async () => {} } };
  globalThis.__settings = {
    customDictionary: ["OpenWhispr", "Supabase", "Whispr"],
    updateCustomDictionary: (changes) => calls.push(["updateCustomDictionary", changes]),
    snippets: [],
    ...settings,
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
    ...shared,
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
  const exported = [];
  const electronAPI = {
    exportDictionary: async (words) => {
      exported.push(words);
      return {};
    },
  };
  const { storage } = installBrowserGlobals(t, { initialStorage, window: { electronAPI } });
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-dictionary-view-test-",
    noExternal: ["react-i18next"],
    mockModules: MOCKS,
  });
  const { default: DictionaryView } = await vite.ssrLoadModule("/components/DictionaryView.tsx");
  // Loaded after the DOM is installed, so react-dom detects native input events.
  const { createRoot } = require("react-dom/client");
  root = createRoot(container);
  await React.act(async () => root.render(createElement(DictionaryView)));
  return { container, calls, storage, exported };
}

const click = (element) =>
  React.act(async () => element.dispatchEvent({ type: "click", bubbles: true }));

const domEvent = (type, extra = {}) => ({
  type,
  bubbles: true,
  ...extra,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {
    this.cancelBubble = true;
  },
});

// React's change event reads the new value from the element, then an input event.
// It only treats an <input> as text when its type property says so, which this
// DOM leaves unset for an input rendered without a type.
const type = (element, value) =>
  React.act(async () => {
    element.type ??= "text";
    element.value = value;
    element.dispatchEvent(domEvent("input"));
  });

const pressEnter = (element) =>
  React.act(async () => element.dispatchEvent(domEvent("keydown", { key: "Enter" })));

const addInput = (container) =>
  findElement(
    container,
    (node) =>
      node.tagName === "INPUT" &&
      node.getAttribute("placeholder") === "dictionary.shared.add.placeholder"
  );

const byAttribute = (container, name, value = "") =>
  findElement(container, (node) => node.getAttribute?.(name) === value);

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

const ariaLabels = (row) => buttonsIn(row).map((button) => button.getAttribute("aria-label"));
const named = (key, word) => `${key}{"word":"${word}"}`;

test("shared row hover exposes Edit, Hide for me and Delete for everyone by aria-label", async (t) => {
  const { container, calls } = await renderView(t);
  await openList(container, `space:${ENGINEERING}`);
  // The tooltip is the short action; the accessible name says which word.
  assert.deepEqual(ariaLabels(rowFor(container, "Qdrant")), [
    named("dictionary.shared.selection.selectWord", "Qdrant"),
    named("dictionary.editWord", "Qdrant"),
    named("dictionary.shared.actions.hideWord", "Qdrant"),
    named("dictionary.shared.actions.deleteForEveryoneWord", "Qdrant"),
  ]);

  await click(buttonsIn(rowFor(container, "Qdrant"))[2]);
  assert.deepEqual(
    calls.find(([name]) => name === "setSharedWordsHidden"),
    ["setSharedWordsHidden", "ws", ["e-qdrant"], true]
  );
});

test("Delete for everyone runs only after confirming, then offers Undo", async (t) => {
  const { container, calls } = await renderView(t);
  await openList(container, `space:${ENGINEERING}`);
  const deleteButton = () => buttonsIn(rowFor(container, "Qdrant"))[3];
  const dialog = () =>
    findElement(container, (node) =>
      node.getAttribute?.("data-dialog")?.includes("deleteOneTitle")
    );

  await click(deleteButton());
  assert.equal(
    dialog().getAttribute("data-dialog"),
    'dictionary.shared.deleteOneTitle{"word":"Qdrant","list":"Engineering"}'
  );
  await click(byAttribute(dialog(), "data-cancel"));
  assert.equal(dialog(), null);
  assert.equal(
    calls.find(([name]) => name === "deleteSharedWords"),
    undefined
  );

  await click(deleteButton());
  await click(byAttribute(dialog(), "data-confirm"));
  assert.equal(dialog(), null);
  assert.deepEqual(
    calls.filter(([name]) => name === "deleteSharedWords"),
    [["deleteSharedWords", "ws", ["e-qdrant"]]]
  );
  assert.equal(globalThis.__toasts.at(-1).actions[0].label, "dictionary.shared.undo");
});

test("personal and hidden rows have their own hover actions", async (t) => {
  const { container } = await renderView(t);
  await openList(container, "personal");
  assert.deepEqual(ariaLabels(rowFor(container, "OpenWhispr")), [
    named("dictionary.shared.selection.selectWord", "OpenWhispr"),
    named("dictionary.shared.actions.shareWord", "OpenWhispr"),
    named("dictionary.editWord", "OpenWhispr"),
    named("dictionary.shared.actions.deleteWord", "OpenWhispr"),
  ]);

  globalThis.__shared.snapshot = { ...SNAPSHOT, hiddenIds: ["e-arr"] };
  await openList(container, "hidden");
  assert.deepEqual(ariaLabels(rowFor(container, "ARR")), [
    named("dictionary.shared.actions.unhideWord", "ARR"),
  ]);
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

test("Enter adds to Personal through the settings store and to a shared list through the API", async (t) => {
  const { container, calls } = await renderView(t);
  globalThis.__results.addSharedWords = { added: ["Grafana"], alreadyPresent: [], failed: null };

  await openList(container, "personal");
  await type(addInput(container), "Grafana");
  await pressEnter(addInput(container));
  assert.deepEqual(
    calls.find(([name]) => name === "updateCustomDictionary"),
    ["updateCustomDictionary", { add: ["Grafana"] }]
  );
  assert.equal(addInput(container).value, "");

  await openList(container, `space:${ENGINEERING}`);
  await type(addInput(container), "Grafana");
  await pressEnter(addInput(container));
  assert.deepEqual(
    calls.find(([name]) => name === "addSharedWords"),
    ["addSharedWords", "ws", ENGINEERING, ["Grafana"]]
  );
});

test("a word already in the target is refused inline", async (t) => {
  const { container, calls } = await renderView(t);
  await openList(container, `space:${ENGINEERING}`);
  await type(addInput(container), "qdrant");
  assert.ok(container.textContent.includes('dictionary.shared.alreadyIn{"list":"Engineering"}'));
  await pressEnter(addInput(container));
  assert.equal(
    calls.find(([name]) => name === "addSharedWords"),
    undefined
  );
});

test("a rename the list already has keeps the editor open with the reason", async (t) => {
  const { container, calls } = await renderView(t);
  globalThis.__results.editSharedWord = "throw:alreadyInList";
  await openList(container, `space:${ENGINEERING}`);
  await click(buttonsIn(rowFor(container, "Qdrant"))[1]);
  const editor = () => findElement(rowFor(container, "Qdrant"), (node) => node.tagName === "INPUT");

  // An empty word is never sent.
  await type(editor(), "  ");
  await pressEnter(editor());
  assert.equal(
    calls.find(([name]) => name === "editSharedWord"),
    undefined
  );
  assert.ok(editor());

  await type(editor(), "sherpa-onnx ");
  await pressEnter(editor());
  assert.deepEqual(
    calls.find(([name]) => name === "editSharedWord"),
    ["editSharedWord", "ws", "e-qdrant", "sherpa-onnx"]
  );
  assert.ok(editor(), "the editor stays open");
  assert.ok(
    rowFor(container, "Qdrant").textContent.includes(
      'dictionary.shared.alreadyIn{"list":"Engineering"}'
    )
  );
});

test("Sync pulls the shared lists and the personal dictionary", async (t) => {
  const { container, calls } = await renderView(t);
  await click(byAttribute(container, "aria-label", "dictionary.shared.toolbar.sync"));
  assert.ok(calls.some(([name]) => name === "syncShared"));
  assert.ok(calls.some(([name]) => name === "syncPersonal"));
});

test("a requested list opens first and the request is cleared", async (t) => {
  const { container } = await renderView(t, {
    shared: { requestedList: `space:${SALES}` },
  });
  assert.equal(pickerEntry(container, `space:${SALES}`).getAttribute("aria-current"), "true");
  assert.equal(pickerEntry(container, "all").getAttribute("aria-current"), null);
  assert.equal(globalThis.__shared.requestedList, null);
  assert.ok(rowFor(container, "MEDDICC"));
});

test("clear-all and export leave out moved words, which can be added back", async (t) => {
  const snapshot = {
    ...SNAPSHOT,
    entries: [...SNAPSHOT.entries, entry("e-supabase", "Supabase", null)],
  };
  const { container, calls, exported } = await renderView(t, {
    shared: { snapshot, movedPersonal: ["Supabase"] },
  });
  await openList(container, "personal");
  assert.equal(rowFor(container, "Supabase"), null);

  await click(byAttribute(container, "aria-label", "dictionary.clearAll"));
  await click(
    byAttribute(byAttribute(container, "data-dialog", "dictionary.clearTitle"), "data-confirm")
  );
  assert.deepEqual(
    calls.find(([name]) => name === "updateCustomDictionary"),
    ["updateCustomDictionary", { remove: ["OpenWhispr"] }]
  );

  await click(byAttribute(container, "aria-label", "dictionary.exportDictionary"));
  // The export keeps the agent name, as it always has.
  assert.deepEqual(exported, [["OpenWhispr", "Whispr"]]);

  // A moved word isn't shown in Personal, so adding it back is allowed.
  await type(addInput(container), "Supabase");
  assert.ok(!container.textContent.includes("dictionary.shared.alreadyIn"));
  await pressEnter(addInput(container));
  assert.deepEqual(calls.filter(([name]) => name === "updateCustomDictionary").at(-1), [
    "updateCustomDictionary",
    { add: ["Supabase"] },
  ]);
});

const checkboxFor = (container, word) =>
  findElement(
    rowFor(container, word),
    (node) => node.tagName === "BUTTON" && node.getAttribute("role") === "checkbox"
  );

const shiftClick = (element) =>
  React.act(async () => element.dispatchEvent({ type: "click", bubbles: true, shiftKey: true }));

const keyDown = (element, key, extra = {}) =>
  React.act(async () => element.dispatchEvent(domEvent("keydown", { key, ...extra })));

const toolbar = (container) => byAttribute(container, "role", "toolbar");

const barButton = (container, label) =>
  findElement(
    toolbar(container),
    (node) => node.tagName === "BUTTON" && node.textContent === label
  );

const checkedWords = (container) =>
  container
    .querySelectorAll("li")
    .filter(
      (node) =>
        checkboxFor(container, node.getAttribute("data-word"))?.getAttribute("aria-checked") ===
        "true"
    )
    .map((node) => node.getAttribute("data-word"));

const FIVE_WORDS = { customDictionary: ["Biscuit", "Piha", "Qdrant", "sherpa-onnx", "Tiptap"] };

test("shift-click selects a range in the list", async (t) => {
  const { container } = await renderView(t, { settings: FIVE_WORDS });
  await openList(container, "personal");
  assert.equal(toolbar(container), null, "no bar until something is ticked");

  await click(checkboxFor(container, "Biscuit"));
  await shiftClick(checkboxFor(container, "Qdrant"));
  assert.deepEqual(checkedWords(container), ["Biscuit", "Piha", "Qdrant"]);

  const bar = toolbar(container).textContent;
  assert.ok(bar.includes('dictionary.shared.selection.count{"count":3}'));
  assert.ok(bar.includes('dictionary.shared.selection.selectAll{"total":5}'));
  // With a selection, rows keep only their checkbox: the hover actions step aside.
  assert.deepEqual(ariaLabels(rowFor(container, "Tiptap")), [
    named("dictionary.shared.selection.selectWord", "Tiptap"),
  ]);

  await click(barButton(container, 'dictionary.shared.selection.selectAll{"total":5}'));
  assert.equal(checkedWords(container).length, 5);
});

test("⌘A selects all while the list has focus, Esc clears, and a new list starts empty", async (t) => {
  const { container, calls } = await renderView(t, { settings: FIVE_WORDS });
  await openList(container, "personal");
  const list = container.querySelector("ul");

  // The add field keeps ⌘A for its text.
  await keyDown(addInput(container), "a", { metaKey: true });
  assert.equal(toolbar(container), null);

  await keyDown(list, "a", { metaKey: true });
  assert.equal(checkedWords(container).length, 5);
  await keyDown(list, "Escape");
  assert.equal(toolbar(container), null);

  await click(checkboxFor(container, "Piha"));
  await click(barButton(container, "dictionary.shared.actions.delete"));
  assert.deepEqual(calls.filter(([name]) => name === "updateCustomDictionary").at(-1), [
    "updateCustomDictionary",
    { remove: ["Piha"] },
  ]);
  assert.equal(toolbar(container), null, "a finished bulk action clears the selection");
  assert.deepEqual(globalThis.__toasts, [], "deleting one word offers no Undo, as before");

  await click(checkboxFor(container, "Tiptap"));
  await openList(container, "all");
  assert.equal(toolbar(container), null);
});

test("the selection bar shares to the ticked lists; unshared words stay selected", async (t) => {
  const { container, calls } = await renderView(t, { settings: FIVE_WORDS });
  await openList(container, "personal");
  await click(checkboxFor(container, "Biscuit"));
  await click(checkboxFor(container, "Piha"));

  await click(barButton(container, "dictionary.shared.selection.shareWith"));
  const popover = () => byAttribute(container, "data-popover");
  assert.ok(popover().textContent.includes('dictionary.shared.share.titleMany{"count":2}'));
  const engineering = findElement(
    popover(),
    (node) =>
      node.getAttribute?.("role") === "checkbox" && node.textContent.startsWith("Engineering")
  );
  await click(engineering);
  globalThis.__results.sharePersonalWords = {
    moved: ["Biscuit"],
    alreadyPresent: [],
    failed: { words: ["Piha"], reason: "personalChanged" },
  };
  const share = () =>
    findElement(
      popover(),
      (node) =>
        node.tagName === "BUTTON" &&
        node.getAttribute("role") !== "checkbox" &&
        node.textContent === "dictionary.shared.actions.share"
    );
  await click(share());

  assert.deepEqual(
    calls.find(([name]) => name === "sharePersonalWords"),
    ["sharePersonalWords", "ws", [ENGINEERING], ["Biscuit", "Piha"]]
  );
  assert.deepEqual(globalThis.__toasts.at(-1), {
    title: 'dictionary.shared.share.partial{"moved":1,"total":2,"count":1}',
    description: "dictionary.shared.share.reasons.personalChanged",
    variant: "destructive",
  });
  assert.equal(popover(), null);
  // The mock leaves Biscuit in Personal; the real move takes it out of the list.
  assert.deepEqual(checkedWords(container), ["Biscuit", "Piha"]);

  // A full share clears the selection.
  globalThis.__results.sharePersonalWords = { moved: ["Piha"], alreadyPresent: [], failed: null };
  await click(barButton(container, "dictionary.shared.selection.shareWith"));
  await click(
    findElement(
      popover(),
      (node) =>
        node.getAttribute?.("role") === "checkbox" && node.textContent.startsWith("Engineering")
    )
  );
  await click(share());
  assert.equal(toolbar(container), null);
});

test("a row's Share icon opens the popover for that word", async (t) => {
  const { container } = await renderView(t);
  await openList(container, "personal");
  await click(
    byAttribute(container, "aria-label", named("dictionary.shared.actions.shareWord", "OpenWhispr"))
  );
  assert.ok(
    byAttribute(container, "data-popover").textContent.includes(
      'dictionary.shared.share.titleOne{"word":"OpenWhispr"}'
    )
  );
});

test("a shared list's bar hides for me and deletes for everyone after confirming", async (t) => {
  const { container, calls } = await renderView(t);
  await openList(container, `space:${ENGINEERING}`);
  // Personal-only actions never show for shared words.
  await click(checkboxFor(container, "Qdrant"));
  assert.equal(barButton(container, "dictionary.shared.selection.shareWith"), null);
  await click(checkboxFor(container, "sherpa-onnx"));

  await click(barButton(container, "dictionary.shared.actions.hide"));
  assert.deepEqual(
    calls.find(([name]) => name === "setSharedWordsHidden"),
    ["setSharedWordsHidden", "ws", ["e-qdrant", "e-sherpa"], true]
  );
  assert.equal(toolbar(container), null);

  await click(checkboxFor(container, "Qdrant"));
  await click(checkboxFor(container, "sherpa-onnx"));
  await click(barButton(container, "dictionary.shared.actions.deleteForEveryone"));
  const dialog = byAttribute(
    container,
    "data-dialog",
    'dictionary.shared.deleteManyTitle{"count":2,"list":"Engineering"}'
  );
  assert.ok(dialog);
  assert.equal(
    calls.find(([name]) => name === "deleteSharedWords"),
    undefined
  );
  await click(byAttribute(dialog, "data-confirm"));
  assert.deepEqual(
    calls.find(([name]) => name === "deleteSharedWords"),
    ["deleteSharedWords", "ws", ["e-qdrant", "e-sherpa"]]
  );
  assert.equal(globalThis.__toasts.at(-1).actions[0].label, "dictionary.shared.undo");
  assert.equal(toolbar(container), null);
});

test("the Hidden list has no checkboxes", async (t) => {
  const { container } = await renderView(t, {
    shared: { snapshot: { ...SNAPSHOT, hiddenIds: ["e-arr"] } },
  });
  await openList(container, "hidden");
  assert.equal(checkboxFor(container, "ARR"), null);
});

test("⌘A then Delete in Personal offers Undo, which adds every removed word back", async (t) => {
  const { container, calls } = await renderView(t, { settings: FIVE_WORDS });
  await openList(container, "personal");
  await keyDown(container.querySelector("ul"), "a", { metaKey: true });
  await click(barButton(container, "dictionary.shared.actions.delete"));

  const removed = ["Biscuit", "Piha", "Qdrant", "sherpa-onnx", "Tiptap"];
  assert.deepEqual(calls.filter(([name]) => name === "updateCustomDictionary").at(-1), [
    "updateCustomDictionary",
    { remove: removed },
  ]);
  const toast = globalThis.__toasts.at(-1);
  assert.equal(toast.title, 'dictionary.shared.deletedPersonalMany{"count":5}');
  assert.equal(toast.actions[0].label, "dictionary.shared.undo");

  await React.act(async () => toast.actions[0].onClick());
  assert.deepEqual(calls.filter(([name]) => name === "updateCustomDictionary").at(-1), [
    "updateCustomDictionary",
    { add: removed },
  ]);
});

const shareTo = async (container, labels) => {
  await click(barButton(container, "dictionary.shared.selection.shareWith"));
  const popover = byAttribute(container, "data-popover");
  for (const label of labels) {
    await click(
      findElement(
        popover,
        (node) => node.getAttribute?.("role") === "checkbox" && node.textContent.startsWith(label)
      )
    );
  }
  await click(
    findElement(
      popover,
      (node) =>
        node.tagName === "BUTTON" &&
        node.getAttribute("role") !== "checkbox" &&
        node.textContent === "dictionary.shared.actions.share"
    )
  );
};

test("a full list is named when known and generic when the share went to several", async (t) => {
  const { container } = await renderView(t, { settings: FIVE_WORDS });
  await openList(container, "personal");
  await click(checkboxFor(container, "Biscuit"));
  await click(checkboxFor(container, "Piha"));
  await click(checkboxFor(container, "Tiptap"));

  globalThis.__results.sharePersonalWords = {
    moved: ["Biscuit"],
    alreadyPresent: [],
    failed: { words: ["Piha", "Tiptap"], reason: "listFull", target: ENGINEERING },
  };
  await shareTo(container, ["Engineering"]);
  assert.deepEqual(globalThis.__toasts.at(-1), {
    title: 'dictionary.shared.share.partial{"moved":1,"total":3,"count":2}',
    description: 'dictionary.shared.errors.listFull{"list":"Engineering"}',
    variant: "destructive",
  });

  globalThis.__results.sharePersonalWords = {
    moved: [],
    alreadyPresent: [],
    failed: { words: ["Biscuit", "Piha", "Tiptap"], reason: "listFull" },
  };
  await shareTo(container, ["Engineering", "Sales"]);
  assert.deepEqual(globalThis.__toasts.at(-1), {
    title: "dictionary.shared.share.reasons.aListFull",
    variant: "destructive",
  });
});

test("a ticked row that leaves the list isn't still ticked when it comes back", async (t) => {
  const { container } = await renderView(t, { settings: FIVE_WORDS });
  await openList(container, "personal");
  await click(checkboxFor(container, "Piha"));
  await click(checkboxFor(container, "Tiptap"));

  await click(byAttribute(container, "aria-label", "dictionary.shared.toolbar.search"));
  const search = () =>
    findElement(
      container,
      (node) =>
        node.tagName === "INPUT" &&
        node.getAttribute("aria-label") === "dictionary.shared.toolbar.search"
    );
  await type(search(), "ti");
  assert.deepEqual(checkedWords(container), ["Tiptap"]);

  await type(search(), "");
  assert.deepEqual(checkedWords(container), ["Tiptap"], "Piha left the list, so it was unticked");
});
