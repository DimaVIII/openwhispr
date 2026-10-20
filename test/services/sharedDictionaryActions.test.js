// The shared dictionary write actions, driven with the main-process mirror and
// the personal-dictionary IPC faked, and each /api/shared-dictionary route
// answered by a per-test responder. The real SharedDictionaryService and
// cloudApi run unchanged; the store reload and the sync kicks are counted.

const test = require("node:test");
const assert = require("node:assert/strict");

const harness = require("../helpers/harness/browserGlobals.js");
const { createSharedDictionaryDb } = require("../helpers/harness/sharedDictionaryFakes.js");

const WS = "11111111-1111-4111-8111-111111111111";
const SPACE = "33333333-3333-4333-8333-333333333333";
const SHARE = "/api/shared-dictionary/share";
const CREATE = "/api/shared-dictionary/create";

let entrySeq = 0;
function entry(word, spaceId = null) {
  entrySeq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(entrySeq).padStart(12, "0")}`,
    workspace_id: WS,
    space_id: spaceId,
    word,
    added_by_user_id: "user-me",
    created_at: "2026-10-20T12:00:00.000Z",
    updated_at: "2026-10-20T12:00:00.000Z",
    deleted_at: null,
  };
}

// A failure as the main-process handler returns it (see cloudApiRequest.js).
function failure(status, code, extra = {}) {
  return { fail: { status, code, error: code ?? "failed", ...extra } };
}

function setup(t, { personal = [] } = {}) {
  harness.resetBrowserGlobals();
  harness.installBrowserGlobals();

  const db = createSharedDictionaryDb();
  const personalByLower = new Map(personal.map((row) => [row.word.toLowerCase(), row]));
  const marks = [];
  const requests = [];
  const responders = new Map();

  harness.window.electronAPI = {
    ...db.api,
    getDictionaryEntriesByWords: async (words) =>
      words
        .map((word) => personalByLower.get(word.toLowerCase()))
        .filter(Boolean)
        .map((row) => ({ word: row.word, cloudId: row.cloudId ?? null })),
    markDictionaryWordsShared: async (words, sharedAt) => {
      marks.push({ words, sharedAt });
      return { marked: words };
    },
    cloudApiRequest: async (options) => {
      const path = options.path.split("?")[0];
      const calls = requests.filter((request) => request.path === path).length;
      requests.push({ path, method: options.method, body: options.body });
      const respond = responders.get(path);
      if (!respond) throw new Error(`no responder for ${path}`);
      const answer = respond(options.body, calls);
      if (answer?.fail) {
        const { status, code, error, conflicts } = answer.fail;
        return {
          success: false,
          error,
          status,
          code,
          details: conflicts ? { conflicts } : undefined,
        };
      }
      return { success: true, data: answer };
    },
  };

  const actions = require("../../src/services/sharedDictionaryActions.ts");
  const { useSharedDictionaryStore } = require("../../src/stores/sharedDictionaryStore.ts");
  const { syncService } = require("../../src/services/SyncService.ts");

  const counts = { reloads: 0, sharedSyncs: 0, personalSyncs: 0 };
  const originalReload = useSharedDictionaryStore.getState().reload;
  useSharedDictionaryStore.setState({
    reload: async () => {
      counts.reloads += 1;
    },
  });
  t.after(() => useSharedDictionaryStore.setState({ reload: originalReload }));
  t.mock.method(syncService, "syncSharedDictionaryNow", async () => {
    counts.sharedSyncs += 1;
  });
  t.mock.method(syncService, "syncDictionaryNow", async () => {
    counts.personalSyncs += 1;
  });

  const on = (path, respond) => responders.set(path, respond);
  const requestsTo = (path) => requests.filter((request) => request.path === path);
  return { actions, db, marks, counts, on, requestsTo };
}

// Echoes a share request as the API accepts it: every word lands in every target.
function acceptShare(body) {
  const words = [...body.personal.map((row) => row.word), ...body.words];
  return {
    created: body.targets.flatMap((target) => words.map((word) => entry(word, target))),
    alreadyPresent: [],
    movedPersonalIds: body.personal.map((row) => row.id),
  };
}

const syncedPersonal = (count) =>
  Array.from({ length: count }, (_, index) => ({
    word: `Word${index}`,
    cloudId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
  }));

test("share marks personal words only after the server accepts", async (t) => {
  const ctx = setup(t, { personal: syncedPersonal(3) });
  ctx.on(SHARE, () => failure(500, undefined));

  const result = await ctx.actions.sharePersonalWords(WS, [null], ["Word0", "Word1", "Word2"]);

  assert.equal(ctx.requestsTo(SHARE).length, 1);
  assert.deepEqual(ctx.marks, [], "nothing is marked shared");
  assert.deepEqual(result.moved, []);
  assert.deepEqual(result.failed, { words: ["Word0", "Word1", "Word2"], reason: "network" });
  assert.equal(ctx.db.callsNamed("applySharedDictionaryPull").length, 0);
});

test("share sends {id, word} for synced words and plain words for unsynced ones", async (t) => {
  const ctx = setup(t, {
    personal: [
      { word: "Kubernetes", cloudId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001" },
      { word: "Qdrant", cloudId: null },
    ],
  });
  ctx.on(SHARE, (body) => ({
    ...acceptShare(body),
    alreadyPresent: [{ space_id: SPACE, word: "Kubernetes" }],
  }));

  const result = await ctx.actions.sharePersonalWords(WS, [null, SPACE], ["kubernetes", "Qdrant"]);

  const [request] = ctx.requestsTo(SHARE);
  assert.deepEqual(request.body, {
    workspace_id: WS,
    targets: [null, SPACE],
    personal: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", word: "Kubernetes" }],
    words: ["Qdrant"],
  });
  assert.deepEqual(result.moved, ["kubernetes", "Qdrant"]);
  assert.deepEqual(result.alreadyPresent, [{ target: SPACE, word: "Kubernetes" }]);
  assert.equal(result.failed, null);
  assert.equal(ctx.marks.length, 1);
  assert.deepEqual(ctx.marks[0].words, ["kubernetes", "Qdrant"]);
  assert.ok(!Number.isNaN(Date.parse(ctx.marks[0].sharedAt)));
  const [pull] = ctx.db.callsNamed("applySharedDictionaryPull");
  assert.equal(pull.workspaceId, WS);
  assert.equal(pull.upserts.length, 4, "every created entry is applied locally");
  assert.deepEqual(pull.deletedIds, []);
  assert.equal(ctx.counts.reloads, 1);
  assert.equal(ctx.counts.sharedSyncs, 1);
  assert.equal(ctx.counts.personalSyncs, 0);
});

test("second chunk failure keeps the first 200 shared and returns the other 250", async (t) => {
  const personal = syncedPersonal(450);
  const words = personal.map((row) => row.word);
  const ctx = setup(t, { personal });
  ctx.on(SHARE, (body, call) =>
    call === 1 ? failure(400, "SHARED_DICTIONARY_LIST_FULL") : acceptShare(body)
  );

  const result = await ctx.actions.sharePersonalWords(WS, [null], words);

  assert.equal(ctx.requestsTo(SHARE).length, 2, "the loop stops at the failing chunk");
  assert.deepEqual(result.moved, words.slice(0, 200));
  assert.deepEqual(result.failed, { words: words.slice(200), reason: "listFull" });
  assert.equal(ctx.marks.length, 1);
  assert.deepEqual(ctx.marks[0].words, words.slice(0, 200));
  const pulls = ctx.db.callsNamed("applySharedDictionaryPull");
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].upserts.length, 200);
});

test("PERSONAL_CHANGED maps to personalChanged and triggers a personal sync", async (t) => {
  const ctx = setup(t, { personal: syncedPersonal(2) });
  ctx.on(SHARE, () =>
    failure(409, "SHARED_DICTIONARY_PERSONAL_CHANGED", {
      conflicts: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000000", word: "Word0 renamed" }],
    })
  );

  const result = await ctx.actions.sharePersonalWords(WS, [SPACE], ["Word0", "Word1"]);

  assert.deepEqual(result.failed, { words: ["Word0", "Word1"], reason: "personalChanged" });
  assert.deepEqual(result.moved, []);
  assert.equal(ctx.counts.personalSyncs, 1);
  assert.deepEqual(ctx.marks, []);
});

test("share and add never send an empty batch", async (t) => {
  const ctx = setup(t);
  ctx.on(SHARE, acceptShare);
  ctx.on(CREATE, () => ({ created: [], alreadyPresent: [] }));

  const shared = await ctx.actions.sharePersonalWords(WS, [null], ["", "  "]);
  const added = await ctx.actions.addSharedWords(WS, null, [" "]);
  const noTargets = await ctx.actions.sharePersonalWords(WS, [], ["Word0"]);

  assert.equal(ctx.requestsTo(SHARE).length, 0);
  assert.equal(ctx.requestsTo(CREATE).length, 0);
  assert.deepEqual(shared, { moved: [], alreadyPresent: [], failed: null });
  assert.deepEqual(added, { added: [], alreadyPresent: [], failed: null });
  assert.deepEqual(noTargets, { moved: [], alreadyPresent: [], failed: null });
});

test("add chunks by 200, applies each accepted chunk and stops at the first failure", async (t) => {
  const ctx = setup(t);
  const words = Array.from({ length: 450 }, (_, index) => `Term${index}`);
  ctx.on(CREATE, (body, call) => {
    if (call === 1) return failure(403, "SHARED_DICTIONARY_PLAN_REQUIRED");
    return {
      created: body.words.slice(1).map((word) => entry(word, body.space_id)),
      alreadyPresent: [body.words[0]],
    };
  });

  const result = await ctx.actions.addSharedWords(WS, SPACE, [...words, "term0"]);

  const sent = ctx.requestsTo(CREATE);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body, { workspace_id: WS, space_id: SPACE, words: words.slice(0, 200) });
  assert.deepEqual(result.added, words.slice(1, 200));
  assert.deepEqual(result.alreadyPresent, ["Term0"]);
  assert.deepEqual(result.failed, { words: words.slice(200), reason: "planRequired" });
  assert.equal(ctx.db.callsNamed("applySharedDictionaryPull").length, 1);
  assert.equal(ctx.counts.reloads, 1);
  assert.equal(ctx.counts.sharedSyncs, 1);
});

test("409 ALREADY_IN_LIST on edit throws alreadyInList and changes nothing", async (t) => {
  const ctx = setup(t);
  ctx.on("/api/shared-dictionary/update", () => failure(409, "SHARED_DICTIONARY_ALREADY_IN_LIST"));

  await assert.rejects(
    () => ctx.actions.editSharedWord(WS, "e-1", "Kubernetes"),
    (error) =>
      error instanceof ctx.actions.SharedDictionaryActionError && error.reason === "alreadyInList"
  );
  assert.equal(ctx.db.callsNamed("applySharedDictionaryPull").length, 0);
});

test("edit applies the updated entry locally", async (t) => {
  const ctx = setup(t);
  const updated = entry("Kubernetes");
  ctx.on("/api/shared-dictionary/update", () => updated);

  await ctx.actions.editSharedWord(WS, updated.id, "Kubernetes");

  const [request] = ctx.requestsTo("/api/shared-dictionary/update");
  assert.deepEqual(request.body, { workspace_id: WS, id: updated.id, word: "Kubernetes" });
  assert.deepEqual(ctx.db.callsNamed("applySharedDictionaryPull")[0].upserts, [updated]);
  assert.equal(ctx.counts.reloads, 1);
  assert.equal(ctx.counts.sharedSyncs, 1);
});

test("error codes map to action reasons", async (t) => {
  const cases = [
    [failure(403, "SHARED_DICTIONARY_PLAN_REQUIRED"), "planRequired"],
    [failure(403, "SSO_REQUIRED"), "ssoRequired"],
    [failure(404, "SHARED_DICTIONARY_NOT_MEMBER"), "notMember"],
    [failure(400, "SHARED_DICTIONARY_LIST_FULL"), "listFull"],
    [failure(409, "SHARED_DICTIONARY_ALREADY_IN_LIST"), "alreadyInList"],
    [failure(409, "SHARED_DICTIONARY_PERSONAL_CHANGED"), "personalChanged"],
    [failure(404, undefined), "network"],
    [failure(undefined, undefined), "network"],
  ];
  for (const [answer, reason] of cases) {
    const ctx = setup(t);
    ctx.on("/api/shared-dictionary/update", () => answer);
    await assert.rejects(
      () => ctx.actions.editSharedWord(WS, "e-1", "Word"),
      (error) => error.reason === reason,
      `${answer.fail.code ?? answer.fail.status} -> ${reason}`
    );
  }
});

test("delete applies the deleted ids and returns undo that calls restore", async (t) => {
  const ctx = setup(t);
  const rows = [entry("Qdrant"), entry("Orukeet"), entry("Parakeet")];
  ctx.db.seed(WS, { entries: rows });
  const ids = rows.map((row) => row.id);
  // The third id was already gone on the server, so it is skipped.
  ctx.on("/api/shared-dictionary/delete", () => ({ deletedIds: ids.slice(0, 2) }));
  ctx.on("/api/shared-dictionary/restore", (body) => ({
    restored: rows.filter((row) => body.ids.includes(row.id)),
    conflicts: [],
  }));

  const { undo } = await ctx.actions.deleteSharedWords(WS, ids);

  assert.equal(ctx.requestsTo("/api/shared-dictionary/delete")[0].method, "DELETE");
  assert.deepEqual(ctx.db.callsNamed("applySharedDictionaryPull")[0].deletedIds, ids.slice(0, 2));
  assert.deepEqual(
    (await ctx.db.api.getSharedDictionary(WS)).entries.map((row) => row.word),
    ["Parakeet"]
  );

  await undo();

  const [restore] = ctx.requestsTo("/api/shared-dictionary/restore");
  assert.deepEqual(restore.body, { workspace_id: WS, ids: ids.slice(0, 2) });
  assert.deepEqual(
    (await ctx.db.api.getSharedDictionary(WS)).entries.map((row) => row.word).sort(),
    ["Orukeet", "Parakeet", "Qdrant"]
  );
  assert.equal(ctx.counts.reloads, 2);
  assert.equal(ctx.counts.sharedSyncs, 2);
});

test("hiding and unhiding apply the server's hide rows", async (t) => {
  const ctx = setup(t);
  const rows = [entry("Qdrant"), entry("Orukeet")];
  ctx.db.seed(WS, { entries: rows });
  ctx.on("/api/shared-dictionary/hide", (body) => ({
    hides: body.ids.map((id) => ({
      entry_id: id,
      workspace_id: WS,
      updated_at: "2026-10-20T13:00:00.000Z",
      deleted_at: body.hidden ? null : "2026-10-20T13:00:00.000Z",
    })),
  }));

  await ctx.actions.setSharedWordsHidden(WS, [rows[0].id, rows[1].id], true);
  assert.deepEqual((await ctx.db.api.getSharedDictionary(WS)).hiddenIds.length, 2);

  await ctx.actions.setSharedWordsHidden(WS, [rows[0].id], false);
  const [, unhide] = ctx.db.callsNamed("applySharedDictionaryHides");
  assert.deepEqual(unhide.unhidden, [rows[0].id]);
  assert.deepEqual(unhide.hidden, []);
  assert.deepEqual((await ctx.db.api.getSharedDictionary(WS)).hiddenIds, [rows[1].id]);
});
