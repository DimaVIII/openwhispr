const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectSharedHintWords,
  EMPTY_SHARED_HINTS,
} = require("../../src/utils/sharedDictionaryHints.ts");

const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";

function entry(cloudId, spaceId, word) {
  return {
    cloudId,
    spaceId,
    word,
    addedByUserId: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
}

function meta(overrides = {}) {
  return {
    scopes: [
      { space_id: null, name: "Workspace", member_count: 3, word_count: 1 },
      { space_id: SPACE_A, name: "Space A", member_count: 2, word_count: 2 },
    ],
    contributors: [],
    paused: false,
    syncedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

test("selectSharedHintWords excludes hidden, paused and out-of-scope words", () => {
  const entries = [
    entry("e1", SPACE_A, "Kubernetes"),
    entry("e2", SPACE_A, "Hidden"),
    entry("e3", SPACE_B, "OutOfScope"),
    entry("e4", null, "Acme"),
  ];
  assert.deepEqual(selectSharedHintWords({ entries, hiddenIds: ["e2"], meta: meta() }), {
    space: ["Kubernetes"],
    workspace: ["Acme"],
  });
  assert.deepEqual(
    selectSharedHintWords({ entries, hiddenIds: [], meta: meta({ paused: true }) }),
    EMPTY_SHARED_HINTS
  );
  assert.deepEqual(
    selectSharedHintWords({ entries, hiddenIds: [], meta: null }),
    EMPTY_SHARED_HINTS
  );
});

test("workspace words need the workspace list in scope", () => {
  const entries = [entry("e1", null, "Acme"), entry("e2", SPACE_A, "Kubernetes")];
  const spaceOnly = meta({
    scopes: [{ space_id: SPACE_A, name: "Space A", member_count: 2, word_count: 1 }],
  });
  assert.deepEqual(selectSharedHintWords({ entries, hiddenIds: [], meta: spaceOnly }), {
    space: ["Kubernetes"],
    workspace: [],
  });
});
