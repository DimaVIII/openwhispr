// The shared dictionary write actions, driven with the main-process mirror and
// the personal-dictionary IPC faked, and each /api/shared-dictionary route
// answered by a per-test responder. The real SharedDictionaryService and
// cloudApi run unchanged; the store reload and the sync kicks are counted.

const test = require("node:test");
const assert = require("node:assert/strict");

const harness = require("../helpers/harness/browserGlobals.js");
const harnessWindow = () => harness.window;
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

function setup(t, { personal = [], canSync = false } = {}) {
  harness.resetBrowserGlobals();
  harness.installBrowserGlobals();

  const db = createSharedDictionaryDb();
  const personalByLower = new Map(personal.map((row) => [row.word.toLowerCase(), { ...row }]));
  const marks = [];
  const retires = [];
  let broadcasts = 0;
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
      for (const word of words) {
        const row = personalByLower.get(word.toLowerCase());
        if (row) row.sharedAt = sharedAt;
      }
      return { marked: words };
    },
    retireMovedDictionaryWords: async (words) => {
      retires.push(words);
      const retired = [];
      for (const word of words) {
        const row = personalByLower.get(word.toLowerCase());
        if (!row?.sharedAt) continue;
        personalByLower.delete(word.toLowerCase());
        retired.push(row.word);
      }
      return { retired };
    },
    getDictionary: async () => [...personalByLower.values()].map((row) => row.word),
    broadcastDictionaryUpdated: async () => {
      broadcasts += 1;
      return { success: true };
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
  const { useSettingsStore } = require("../../src/stores/settingsStore.ts");

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
  t.mock.method(syncService, "canSync", () => canSync);

  const on = (path, respond) => responders.set(path, respond);
  const requestsTo = (path) => requests.filter((request) => request.path === path);
  const personalWords = () => [...personalByLower.values()].map((row) => row.word);
  const customDictionary = () => useSettingsStore.getState().customDictionary;
  return {
    actions,
    db,
    marks,
    retires,
    counts,
    on,
    requestsTo,
    personalWords,
    customDictionary,
    broadcasts: () => broadcasts,
  };
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
  const ctx = setup(t, { personal: syncedPersonal(2), canSync: true });
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
  assert.equal(ctx.requestsTo(SHARE).length, 1, "with backup on there is no retry");
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

const DELETE = "/api/shared-dictionary/delete";
const RESTORE = "/api/shared-dictionary/restore";
const HIDE = "/api/shared-dictionary/hide";

const hideRows = (body) =>
  body.ids.map((id) => ({
    entry_id: id,
    workspace_id: WS,
    updated_at: "2026-10-20T13:00:00.000Z",
    deleted_at: body.hidden ? null : "2026-10-20T13:00:00.000Z",
  }));

const manyIds = (count) =>
  Array.from(
    { length: count },
    (_, index) => `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`
  );

test("PERSONAL_CHANGED with backup off retries once with the conflicts as plain words", async (t) => {
  const personal = syncedPersonal(3);
  const ctx = setup(t, { personal });
  ctx.on(SHARE, (body, call) =>
    call === 0
      ? failure(409, "SHARED_DICTIONARY_PERSONAL_CHANGED", {
          conflicts: [{ id: personal[1].cloudId, word: "Word1 renamed" }],
        })
      : acceptShare(body)
  );

  const result = await ctx.actions.sharePersonalWords(WS, [null], ["Word0", "Word1", "Word2"]);

  const [, retry] = ctx.requestsTo(SHARE);
  assert.deepEqual(retry.body.personal, [
    { id: personal[0].cloudId, word: "Word0" },
    { id: personal[2].cloudId, word: "Word2" },
  ]);
  assert.deepEqual(retry.body.words, ["Word1"]);
  assert.equal(result.failed, null);
  assert.deepEqual(result.moved, ["Word0", "Word1", "Word2"]);
  assert.deepEqual(ctx.marks[0].words, ["Word0", "Word1", "Word2"]);
});

test("PERSONAL_CHANGED with backup off fails after one retry", async (t) => {
  const ctx = setup(t, { personal: syncedPersonal(2) });
  ctx.on(SHARE, () => failure(409, "SHARED_DICTIONARY_PERSONAL_CHANGED", { conflicts: [] }));

  const result = await ctx.actions.sharePersonalWords(WS, [null], ["Word0", "Word1"]);

  const sent = ctx.requestsTo(SHARE);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].body.personal, [], "no conflict list: every word goes plain");
  assert.deepEqual(sent[1].body.words, ["Word0", "Word1"]);
  assert.deepEqual(result.failed, { words: ["Word0", "Word1"], reason: "personalChanged" });
  assert.deepEqual(ctx.marks, []);
});

test("a failed mark still applies the created entries", async (t) => {
  const ctx = setup(t, { personal: syncedPersonal(1) });
  ctx.on(SHARE, acceptShare);
  harnessWindow().electronAPI.markDictionaryWordsShared = async () => {
    throw new Error("disk full");
  };
  t.mock.method(console, "warn", () => {});

  const result = await ctx.actions.sharePersonalWords(WS, [null], ["Word0"]);

  assert.deepEqual(result.moved, ["Word0"]);
  assert.equal(ctx.db.callsNamed("applySharedDictionaryPull").length, 1);
});

test("delete and hide send more than 200 ids in chunks", async (t) => {
  const ctx = setup(t);
  const ids = manyIds(450);
  ctx.on(DELETE, (body) => ({ deletedIds: body.ids }));
  ctx.on(RESTORE, () => ({ restored: [], conflicts: [] }));
  ctx.on(HIDE, (body) => ({ hides: hideRows(body) }));

  const { undo } = await ctx.actions.deleteSharedWords(WS, ids);
  await undo();
  await ctx.actions.setSharedWordsHidden(WS, ids, true);

  const sizes = (path) => ctx.requestsTo(path).map((request) => request.body.ids.length);
  assert.deepEqual(sizes(DELETE), [200, 200, 50]);
  assert.deepEqual(sizes(RESTORE), [200, 200, 50]);
  assert.deepEqual(sizes(HIDE), [200, 200, 50]);
});

test("a delete whose second chunk fails carries an undo for the first 200", async (t) => {
  const ctx = setup(t);
  const ids = manyIds(450);
  ctx.on(DELETE, (body, call) => (call === 1 ? failure(500, undefined) : { deletedIds: body.ids }));
  ctx.on(RESTORE, () => ({ restored: [], conflicts: [] }));

  const error = await ctx.actions.deleteSharedWords(WS, ids).then(
    () => assert.fail("expected the delete to throw"),
    (rejection) => rejection
  );

  assert.ok(error instanceof ctx.actions.SharedDictionaryActionError);
  assert.equal(error.reason, "network");
  assert.equal(error.appliedCount, 200);
  assert.equal(ctx.requestsTo(DELETE).length, 2);
  assert.deepEqual(ctx.db.callsNamed("applySharedDictionaryPull")[0].deletedIds, ids.slice(0, 200));

  await error.undo();

  assert.deepEqual(
    ctx.requestsTo(RESTORE).map((request) => request.body),
    [{ workspace_id: WS, ids: ids.slice(0, 200) }]
  );
});

test("a hide whose second chunk fails reports the 200 it hid", async (t) => {
  const ctx = setup(t);
  const ids = manyIds(450);
  ctx.on(HIDE, (body, call) =>
    call === 1 ? failure(404, "SHARED_DICTIONARY_NOT_MEMBER") : { hides: hideRows(body) }
  );

  const error = await ctx.actions.setSharedWordsHidden(WS, ids, true).then(
    () => assert.fail("expected the hide to throw"),
    (rejection) => rejection
  );

  assert.equal(error.reason, "notMember");
  assert.equal(error.appliedCount, 200);
  assert.equal(error.undo, undefined);
  assert.equal(ctx.requestsTo(HIDE).length, 2);
});

function movedPersonal() {
  return [
    {
      word: "Qdrant",
      cloudId: "dddddddd-dddd-4ddd-8ddd-000000000001",
      sharedAt: "2026-10-20T12:00:00.000Z",
    },
    { word: "Orukeet", cloudId: null, sharedAt: "2026-10-20T12:00:00.000Z" },
    { word: "Parakeet", cloudId: "dddddddd-dddd-4ddd-8ddd-000000000003" },
  ];
}

test("hiding a moved word with no other copy retires its personal fallback", async (t) => {
  const ctx = setup(t, { personal: movedPersonal() });
  const rows = [entry("qdrant"), entry("Parakeet")];
  ctx.db.seed(WS, { entries: rows });
  ctx.on(HIDE, (body) => ({ hides: hideRows(body) }));

  await ctx.actions.setSharedWordsHidden(WS, [rows[0].id, rows[1].id], true);

  assert.deepEqual(ctx.retires, [["qdrant", "Parakeet"]]);
  assert.deepEqual(ctx.personalWords(), ["Orukeet", "Parakeet"], "an unmoved word is untouched");
  assert.deepEqual(ctx.customDictionary(), ["Orukeet", "Parakeet"]);
  assert.equal(ctx.broadcasts(), 1);
  assert.equal(ctx.counts.personalSyncs, 1);
});

test("a moved word with another live copy in a second list keeps its fallback", async (t) => {
  const ctx = setup(t, { personal: movedPersonal() });
  const rows = [entry("Qdrant"), entry("QDRANT", SPACE)];
  ctx.db.seed(WS, { entries: rows, scopes: [{ space_id: null }, { space_id: SPACE }] });
  ctx.on(HIDE, (body) => ({ hides: hideRows(body) }));

  await ctx.actions.setSharedWordsHidden(WS, [rows[0].id], true);

  assert.deepEqual(ctx.retires, []);
  assert.deepEqual(ctx.personalWords(), ["Qdrant", "Orukeet", "Parakeet"]);
  assert.equal(ctx.broadcasts(), 0);
  assert.equal(ctx.counts.personalSyncs, 0);
});

test("delete for everyone retires the fallback; unhiding never does", async (t) => {
  const ctx = setup(t, { personal: movedPersonal() });
  const rows = [entry("Orukeet"), entry("Qdrant")];
  ctx.db.seed(WS, { entries: rows });
  ctx.on(DELETE, (body) => ({ deletedIds: body.ids }));
  ctx.on(HIDE, (body) => ({ hides: hideRows(body) }));

  await ctx.actions.setSharedWordsHidden(WS, [rows[1].id], false);
  assert.deepEqual(ctx.retires, []);

  await ctx.actions.deleteSharedWords(WS, [rows[0].id]);

  assert.deepEqual(ctx.retires, [["Orukeet"]]);
  assert.deepEqual(ctx.personalWords(), ["Qdrant", "Parakeet"]);
  assert.deepEqual(ctx.customDictionary(), ["Qdrant", "Parakeet"]);
});
