const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/services/tools/dictionaryTool.ts");

function harness(words, sharedWords = []) {
  const calls = [];
  const hideCalls = [];
  return {
    calls,
    hideCalls,
    actions: {
      getDictionary: () => words,
      updateDictionary: (changes) => calls.push(changes),
      getSharedWords: async () => sharedWords,
      hideSharedWords: async (ids) => {
        hideCalls.push(ids);
      },
    },
  };
}

test("adds new words and removes existing ones case-insensitively in one call", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls } = harness(["OpenWhispr", "Parakeat"]);
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ add: [" Parakeet ", "Orukeet"], remove: ["parakeat"] });

  assert.deepEqual(calls, [{ add: ["Parakeet", "Orukeet"], remove: ["parakeat"] }]);
  assert.deepEqual(result, {
    success: true,
    data: {
      added: ["Parakeet", "Orukeet"],
      removed: ["parakeat"],
      hidden: [],
      alreadyPresent: [],
      notFound: [],
    },
    displayText: 'Added "Parakeet", "Orukeet"; Removed "parakeat"',
  });
});

test("words already present are reported instead of re-added", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls } = harness(["OpenWhispr"]);
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ add: ["openwhispr"] });

  assert.equal(calls.length, 0);
  assert.equal(result.success, false);
  assert.equal(result.displayText, 'Already in the dictionary: "openwhispr"');
});

test("removing a word that is not there fails without writing", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls } = harness(["OpenWhispr"]);
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ remove: ["Whisper"] });

  assert.equal(calls.length, 0);
  assert.deepEqual(result, {
    success: false,
    data: null,
    displayText: 'Not in the dictionary: "Whisper"',
  });
});

test("the tool is a write tool", async () => {
  const { createUpdateDictionaryTool } = await load();
  const tool = createUpdateDictionaryTool(harness([]).actions);
  assert.equal(tool.name, "update_dictionary");
  assert.equal(tool.readOnly, false);
});

test("removing a shared word hides it and never deletes", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls, hideCalls } = harness(
    ["OpenWhispr"],
    [
      { id: "entry-1", word: "Kubernetes" },
      { id: "entry-2", word: "kubernetes" },
    ]
  );
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ remove: ["KUBERNETES"] });

  assert.deepEqual(hideCalls, [["entry-1", "entry-2"]]);
  assert.equal(calls.length, 0);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.hidden, ["KUBERNETES"]);
  assert.deepEqual(result.data.removed, []);
  assert.match(result.displayText, /Hidden for you "KUBERNETES"/);
});

test("a spelling fix hides the shared word and adds the corrected one to Personal", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls, hideCalls } = harness([], [{ id: "entry-1", word: "Parakeat" }]);
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ add: ["Parakeet"], remove: ["Parakeat"] });

  assert.deepEqual(hideCalls, [["entry-1"]]);
  assert.deepEqual(calls, [{ add: ["Parakeet"], remove: [] }]);
  assert.equal(result.success, true);
});

test("a word in Personal is removed from Personal, not hidden", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls, hideCalls } = harness(["Orukeet"], [{ id: "entry-1", word: "Orukeet" }]);
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ remove: ["orukeet"] });

  assert.deepEqual(calls, [{ add: [], remove: ["orukeet"] }]);
  assert.equal(hideCalls.length, 0);
  assert.deepEqual(result.data.removed, ["orukeet"]);
  assert.deepEqual(result.data.hidden, []);
});

test("adding a word that is shared reports alreadyPresent", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls, hideCalls } = harness([], [{ id: "entry-1", word: "Kubernetes" }]);
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ add: ["kubernetes"] });

  assert.equal(calls.length, 0);
  assert.equal(hideCalls.length, 0);
  assert.equal(result.success, false);
  assert.equal(result.displayText, 'Already in the dictionary: "kubernetes"');
});

test("a failed hide changes nothing and reports the failure", async () => {
  const { createUpdateDictionaryTool } = await load();
  const { actions, calls } = harness(["Old"], [{ id: "entry-1", word: "Kubernetes" }]);
  actions.hideSharedWords = async () => {
    throw new Error("offline");
  };
  const tool = createUpdateDictionaryTool(actions);

  const result = await tool.execute({ add: ["New"], remove: ["Old", "Kubernetes"] });

  assert.equal(calls.length, 0);
  assert.equal(result.success, false);
  assert.match(result.displayText, /Could not hide "Kubernetes"/);
});
