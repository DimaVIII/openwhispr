// The shared dictionary pass of SyncService, driven through its public entry
// points with the IPC mirror and the cloud routes faked (harness/
// sharedDictionaryFakes.js). The real SharedDictionaryService, stores and
// hint selector run unchanged.

const test = require("node:test");
const assert = require("node:assert/strict");

const harness = require("../helpers/harness/browserGlobals.js");
const {
  WORKSPACE_SCOPE,
  spaceScope,
  createSharedDictionaryDb,
  createSharedDictionaryCloud,
} = require("../helpers/harness/sharedDictionaryFakes.js");

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const SPACE_B = "33333333-3333-4333-8333-333333333333";
const LIST = "/api/shared-dictionary/list";
const HIDES = "/api/shared-dictionary/hides";
const ENTRIES_CURSOR = `lastSyncedAt.sharedDictionary.${W1}`;
const HIDES_CURSOR = `lastSyncedAt.sharedDictionaryHides.${W1}`;

const flush = () => new Promise((resolve) => setImmediate(resolve));

function modules() {
  return {
    SyncService: require("../../src/services/SyncService.ts").SyncService,
    useWorkspaceStore: require("../../src/stores/workspaceStore.ts").useWorkspaceStore,
    useSharedDictionaryStore: require("../../src/stores/sharedDictionaryStore.ts")
      .useSharedDictionaryStore,
    useSettingsStore: require("../../src/stores/settingsStore.ts").useSettingsStore,
  };
}

async function setup(t, { workspaceId = W1, signedIn = true } = {}) {
  harness.resetBrowserGlobals();
  harness.installBrowserGlobals();
  if (signedIn) harness.localStorage.setItem("isSignedIn", "true");

  const db = createSharedDictionaryDb();
  const cloud = createSharedDictionaryCloud();
  const events = [];
  harness.window.dispatchEvent = (event) => {
    events.push(event);
    return true;
  };
  harness.window.electronAPI = {
    ...db.api,
    cloudApiRequest: cloud.cloudApiRequest,
    authGetTokenState: async () => ({ token: "token-harness", generation: 1 }),
    setSharedDictionaryHints: async () => {},
  };
  await harness.establishValidatedAuth();

  const mods = modules();
  mods.useSharedDictionaryStore.setState({ status: "ready" });
  mods.useWorkspaceStore.setState({ activeWorkspaceId: null });
  if (workspaceId) mods.useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
  await flush();

  const service = new mods.SyncService();
  t.after(() => harness.stopSyncTimers(service));
  const hints = () => mods.useSettingsStore.getState().sharedDictionaryHints;
  const arrivals = () => events.filter((event) => event.type === "shared-dictionary-arrived");
  return { ...mods, db, cloud, service, hints, arrivals };
}

const query = (request) => Object.fromEntries(request.query.entries());

test("first pass pages the snapshot then switches to delta cursors", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  const rows = cloud.add(
    W1,
    Array.from({ length: 250 }, (_, index) => `Word${index}`),
    { created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z" }
  );
  cloud.hide(W1, rows[3].id, "2026-10-20T11:00:00.000Z");

  await service.syncSharedDictionaryNow();

  const [first, second] = cloud.requestsTo(LIST).map(query);
  assert.deepEqual(first, { workspace_id: W1, limit: "200" });
  assert.equal(second.cursor, rows[199].created_at);
  assert.equal(second.cursor_id, rows[199].id);
  assert.equal(second.since, undefined);
  const replaced = db.callsNamed("replaceSharedDictionary");
  assert.equal(replaced.length, 1, "the snapshot is written once");
  assert.equal(replaced[0].entries.length, 250);
  assert.deepEqual(replaced[0].meta.scopes, [WORKSPACE_SCOPE]);
  assert.equal(db.callsNamed("applySharedDictionaryPull").length, 0);
  assert.deepEqual(db.callsNamed("replaceSharedDictionaryHides")[0].hidden, [
    { entryId: rows[3].id, updatedAt: "2026-10-20T11:00:00.000Z" },
  ]);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), "2026-10-20T12:00:00.000Z");
  assert.equal(harness.localStorage.getItem(HIDES_CURSOR), "2026-10-20T12:00:00.000Z");
  assert.equal(ctx.hints().workspace.length, 249, "the hidden word does not apply");

  cloud.add(W1, ["Late"], {
    created_at: "2026-10-20T12:05:00.000Z",
    updated_at: "2026-10-20T12:05:00.000Z",
  });
  cloud.setServerTime("2026-10-20T12:10:00.000Z");
  await service.syncSharedDictionaryNow();

  const delta = query(cloud.requestsTo(LIST)[2]);
  assert.equal(delta.since, "2026-10-20T11:59:50.000Z");
  assert.equal(delta.cursor, undefined);
  const hidesDelta = query(cloud.requestsTo(HIDES)[1]);
  assert.equal(hidesDelta.since, "2026-10-20T11:59:50.000Z");
  assert.equal(db.callsNamed("replaceSharedDictionary").length, 1);
  assert.equal(db.callsNamed("applySharedDictionaryPull").length, 1);
  assert.equal(db.callsNamed("applySharedDictionaryHides").length, 1);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), "2026-10-20T12:10:00.000Z");
  assert.ok(ctx.hints().workspace.includes("Late"));
});

test("delta passes overlap the stored cursor by 10 seconds", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant", "Orukeet"], {
    created_at: "2026-10-20T11:59:55.000Z",
    updated_at: "2026-10-20T11:59:55.000Z",
  });
  await service.syncSharedDictionaryNow();
  harness.localStorage.setItem(ENTRIES_CURSOR, "2026-10-20T12:00:00.000Z");
  harness.localStorage.setItem(`${ENTRIES_CURSOR}.id`, "ffffffff-ffff-4fff-8fff-ffffffffffff");
  const before = await db.api.getSharedDictionary(W1);

  await service.syncSharedDictionaryNow();

  const delta = query(cloud.requestsTo(LIST).at(-1));
  assert.equal(delta.since, "2026-10-20T11:59:50.000Z");
  assert.equal(delta.since_id, undefined, "the overlap never sends since_id");
  const pull = db.callsNamed("applySharedDictionaryPull").at(-1);
  assert.equal(pull.upserts.length, 2, "rows inside the overlap are re-read");
  const after = await db.api.getSharedDictionary(W1);
  assert.deepEqual(after.entries, before.entries, "re-applied rows change nothing");
  assert.deepEqual(after.hiddenIds, before.hiddenIds);
});

test("NOT_MEMBER clears the workspace and its cursors", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();
  assert.deepEqual(ctx.hints().workspace, ["Qdrant"]);

  cloud.failNext(LIST, { status: 404, code: "SHARED_DICTIONARY_NOT_MEMBER" });
  await service.syncSharedDictionaryNow();

  assert.deepEqual(db.callsNamed("clearSharedDictionary").at(-1), {
    name: "clearSharedDictionary",
    workspaceId: W1,
  });
  assert.equal(db.workspaces.has(W1), false);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), null);
  assert.equal(harness.localStorage.getItem(HIDES_CURSOR), null);
  assert.deepEqual(ctx.hints(), { space: [], workspace: [] });
  assert.equal(ctx.useSharedDictionaryStore.getState().status, "ready");
});

test("SSO_REQUIRED clears the workspace like NOT_MEMBER", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();

  cloud.failNext(LIST, { status: 403, code: "SSO_REQUIRED" });
  await service.syncSharedDictionaryNow();

  assert.equal(db.workspaces.has(W1), false);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), null);
  assert.deepEqual(ctx.hints(), { space: [], workspace: [] });
});

test("plain 404 marks unavailable without throwing", async (t) => {
  const ctx = await setup(t);
  const errors = t.mock.method(console, "error", () => {});
  ctx.cloud.failNext(LIST, { status: 404 });

  await ctx.service.syncSharedDictionaryNow();

  assert.equal(ctx.useSharedDictionaryStore.getState().status, "unavailable");
  assert.equal(harness.localStorage.getItem("sharedDictionaryCapability"), "false");
  assert.equal(errors.mock.callCount(), 0, "an older API is not an error");
  assert.equal(ctx.db.calls.length, 0);

  // Once the routes exist, the next pass marks them available again.
  ctx.cloud.add(W1, ["Qdrant"]);
  await ctx.service.syncSharedDictionaryNow();
  assert.equal(ctx.useSharedDictionaryStore.getState().status, "ready");
  assert.equal(harness.localStorage.getItem("sharedDictionaryCapability"), "true");
});

test("arrival event fires once", async (t) => {
  const ctx = await setup(t);
  const { cloud, service } = ctx;

  await service.syncSharedDictionaryNow();
  assert.equal(ctx.arrivals().length, 0, "an empty list is not an arrival");

  cloud.add(W1, ["Qdrant", "Orukeet"]);
  await service.syncSharedDictionaryNow();
  cloud.add(W1, ["Piha"]);
  await service.syncSharedDictionaryNow();

  const arrivals = ctx.arrivals();
  assert.equal(arrivals.length, 1);
  assert.deepEqual(arrivals[0].detail, { workspaceId: W1, count: 2 });
  assert.equal(harness.localStorage.getItem(`sharedDictionaryWelcomed.${W1}`), "true");
});

test("runs when cloud backup is off", async (t) => {
  const ctx = await setup(t);
  // The team-only passes after this one have nothing faked behind them.
  const errors = t.mock.method(console, "error", () => {});
  ctx.cloud.add(W1, ["Qdrant"]);
  assert.equal(ctx.service.canSync(), false);

  await ctx.service.syncAll(true);

  assert.equal(ctx.cloud.requestsTo(LIST).length, 1);
  assert.deepEqual(ctx.hints().workspace, ["Qdrant"]);
  const sharedErrors = errors.mock.calls.filter((call) =>
    String(call.arguments[0]).startsWith("Shared dictionary")
  );
  assert.deepEqual(sharedErrors, []);
});

test("a stale pass does not publish", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  db.seed(W2, { entries: [cloud.add(W2, ["Biscuit"])[0]] });
  cloud.add(W1, ["Qdrant"]);
  const release = cloud.holdNext(LIST);

  const pass = service.syncSharedDictionaryNow();
  await flush();
  ctx.useWorkspaceStore.getState().setActiveWorkspaceId(W2);
  await flush();
  assert.deepEqual(ctx.hints().workspace, ["Biscuit"]);
  release();
  await pass;

  assert.deepEqual(ctx.hints().workspace, ["Biscuit"], "W2's hints stay in place");
  assert.equal(ctx.useSharedDictionaryStore.getState().workspaceId, W2);
  assert.equal(ctx.arrivals().length, 0, "no arrival for the workspace left behind");
  assert.equal(db.workspaces.get(W1).entries.size, 1, "W1's mirror is still written");
  const persisted = JSON.parse(harness.localStorage.getItem("sharedDictionaryHints"));
  assert.equal(persisted.workspaceId, W2);
});

test("expired cursor re-snapshots and replaces", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  db.seed(W1, {
    entries: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        workspace_id: W1,
        space_id: null,
        word: "Gone",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
  });
  harness.localStorage.setItem(ENTRIES_CURSOR, "2026-09-01T00:00:00.000Z");
  harness.localStorage.setItem(HIDES_CURSOR, "2026-09-01T00:00:00.000Z");
  cloud.add(W1, ["Qdrant", "Orukeet"]);
  cloud.failNext(LIST, { status: 410, code: "SHARED_DICTIONARY_CURSOR_EXPIRED" });

  await service.syncSharedDictionaryNow();

  const [expired, snapshot] = cloud.requestsTo(LIST).map(query);
  assert.equal(expired.since, "2026-08-31T23:59:50.000Z");
  assert.equal(snapshot.since, undefined);
  assert.equal(snapshot.cursor, undefined);
  assert.equal(db.callsNamed("replaceSharedDictionary").length, 1);
  assert.equal(db.callsNamed("replaceSharedDictionaryHides").length, 1);
  const words = (await db.api.getSharedDictionary(W1)).entries.map((entry) => entry.word);
  assert.deepEqual(words.sort(), ["Orukeet", "Qdrant"], "the entry the snapshot lacks is gone");
  assert.deepEqual(ctx.hints().workspace.sort(), ["Orukeet", "Qdrant"]);
});

test("the personal backfill resets the dictionary cursor exactly once", async (t) => {
  const ctx = await setup(t);
  harness.localStorage.setItem("lastSyncedAt.dictionary", "2026-10-01T00:00:00.000Z");
  harness.localStorage.setItem("lastSyncedAt.dictionary.id", "dict-1");

  await ctx.service.syncSharedDictionaryNow();
  assert.equal(harness.localStorage.getItem("lastSyncedAt.dictionary"), null);
  assert.equal(harness.localStorage.getItem("lastSyncedAt.dictionary.id"), null);
  assert.equal(harness.localStorage.getItem("dictionarySharedAtBackfill"), "true");

  harness.localStorage.setItem("lastSyncedAt.dictionary", "2026-10-21T00:00:00.000Z");
  await ctx.service.syncSharedDictionaryNow();
  assert.equal(harness.localStorage.getItem("lastSyncedAt.dictionary"), "2026-10-21T00:00:00.000Z");
});

test("a returning scope triggers a fresh snapshot", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();
  const passOne = cloud.requestsTo(LIST).length;

  // Space B's words predate the cursor, so a delta would never send them.
  cloud.add(W1, ["Biscuit"], {
    space_id: SPACE_B,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  });
  cloud.workspace(W1).scopes = [WORKSPACE_SCOPE, spaceScope(SPACE_B, "Space B")];
  cloud.setServerTime("2026-10-20T12:30:00.000Z");
  await service.syncSharedDictionaryNow();

  const [delta, snapshot] = cloud.requestsTo(LIST).slice(passOne).map(query);
  assert.ok(delta.since, "the pass starts as a delta");
  assert.equal(snapshot.since, undefined, "then re-pages from the start");
  assert.equal(snapshot.cursor, undefined);
  assert.equal(db.callsNamed("replaceSharedDictionary").length, 2);
  const hidesQueries = cloud.requestsTo(HIDES).map(query);
  assert.equal(hidesQueries.at(-1).since, undefined, "hides are re-snapshotted too");
  assert.deepEqual(ctx.hints().space, ["Biscuit"]);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), "2026-10-20T12:30:00.000Z");
});

test("no active workspace clears every mirror and cursor", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();

  ctx.useWorkspaceStore.getState().setActiveWorkspaceId(null);
  await flush();
  await service.syncSharedDictionaryNow();

  assert.deepEqual(db.callsNamed("clearSharedDictionary").at(-1).workspaceId, undefined);
  assert.equal(db.workspaces.size, 0);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), null);
  assert.equal(harness.localStorage.getItem(HIDES_CURSOR), null);
  assert.deepEqual(ctx.hints(), { space: [], workspace: [] });
});

test("sign-out clears the shared tables, cursors, welcome, capability and hints", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();
  harness.localStorage.setItem("sharedDictionaryCapability", "false");
  const generation = ctx.useSharedDictionaryStore.getState().generation;
  assert.ok(harness.localStorage.getItem(`sharedDictionaryWelcomed.${W1}`));

  await service.purgeTeamSpacesForSignOut();

  assert.equal(db.workspaces.size, 0);
  assert.equal(db.callsNamed("clearSharedDictionary").at(-1).workspaceId, undefined);
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), null);
  assert.equal(harness.localStorage.getItem(HIDES_CURSOR), null);
  assert.equal(harness.localStorage.getItem(`sharedDictionaryWelcomed.${W1}`), null);
  assert.equal(harness.localStorage.getItem("sharedDictionaryCapability"), null);
  assert.deepEqual(ctx.hints(), { space: [], workspace: [] });
  const state = ctx.useSharedDictionaryStore.getState();
  assert.equal(state.generation, generation + 1);
  assert.equal(state.snapshot, null);
});

test("a delete behind a later snapshot page is still read by the next delta", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  const rows = cloud.add(
    W1,
    Array.from({ length: 250 }, (_, index) => `Word${index}`),
    { created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z" }
  );
  // Between page 1 and page 2, a teammate deletes a word page 1 already sent,
  // and the server clock moves well past the read overlap.
  cloud.beforeServe = (request) => {
    if (request.pathname !== LIST || !request.query.get("cursor")) return;
    Object.assign(rows[5], {
      deleted_at: "2026-10-20T12:00:05.000Z",
      updated_at: "2026-10-20T12:00:05.000Z",
    });
    cloud.setServerTime("2026-10-20T12:00:30.000Z");
    cloud.beforeServe = null;
  };

  await service.syncSharedDictionaryNow();
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), "2026-10-20T12:00:00.000Z");
  const words = async () => (await db.api.getSharedDictionary(W1)).entries.map((e) => e.word);
  assert.ok((await words()).includes("Word5"), "page 1 sent it live");

  await service.syncSharedDictionaryNow();

  assert.equal(query(cloud.requestsTo(LIST).at(-1)).since, "2026-10-20T11:59:50.000Z");
  assert.equal((await words()).includes("Word5"), false);
  assert.equal((await words()).length, 249);
  assert.equal(ctx.hints().workspace.includes("Word5"), false);
});

test("an unhide behind a later hides snapshot page is still read by the next delta", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  const rows = cloud.add(
    W1,
    Array.from({ length: 250 }, (_, index) => `Word${index}`),
    { created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z" }
  );
  for (const row of rows) cloud.hide(W1, row.id, "2026-10-20T11:00:00.000Z");
  const unhidden = cloud.workspace(W1).hides.find((hide) => hide.entry_id === rows[5].id);
  cloud.beforeServe = (request) => {
    if (request.pathname !== HIDES || !request.query.get("cursor")) return;
    Object.assign(unhidden, {
      deleted_at: "2026-10-20T12:00:05.000Z",
      updated_at: "2026-10-20T12:00:05.000Z",
    });
    cloud.setServerTime("2026-10-20T12:00:30.000Z");
    cloud.beforeServe = null;
  };

  await service.syncSharedDictionaryNow();
  assert.equal(harness.localStorage.getItem(HIDES_CURSOR), "2026-10-20T12:00:00.000Z");
  const hidden = async () => (await db.api.getSharedDictionary(W1)).hiddenIds;
  assert.ok((await hidden()).includes(rows[5].id), "page 1 sent the hide");

  await service.syncSharedDictionaryNow();

  assert.equal(query(cloud.requestsTo(HIDES).at(-1)).since, "2026-10-20T11:59:50.000Z");
  assert.equal((await hidden()).includes(rows[5].id), false);
  assert.equal((await hidden()).length, 249);
  assert.deepEqual(ctx.hints().workspace, ["Word5"]);
});

test("a delta stall throws without corrupting state", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  const [row] = cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();
  const before = await db.api.getSharedDictionary(W1);
  const cursor = harness.localStorage.getItem(ENTRIES_CURSOR);
  const errors = t.mock.method(console, "error", () => {});

  // The server keeps answering "more" with the same last row.
  const stuck = {
    entries: [row],
    hasMore: true,
    scopes: [WORKSPACE_SCOPE],
    contributors: [],
    paused: false,
    server_time: "2026-10-20T13:00:00.000Z",
  };
  cloud.respondNext(LIST, stuck);
  cloud.respondNext(LIST, stuck);
  await service.syncSharedDictionaryNow();

  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0].arguments[1]), /delta stopped advancing/);
  assert.equal(cloud.requestsTo(LIST).length, 3, "it gives up instead of looping");
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), cursor);
  assert.deepEqual(await db.api.getSharedDictionary(W1), before);
  assert.deepEqual(ctx.hints().workspace, ["Qdrant"]);
});

test("a 410 from /hides restarts as a hides snapshot", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  const [kept, unhidden] = cloud.add(W1, ["Qdrant", "Orukeet"]);
  cloud.hide(W1, unhidden.id);
  await service.syncSharedDictionaryNow();
  assert.deepEqual((await db.api.getSharedDictionary(W1)).hiddenIds, [unhidden.id]);

  // The hide is undone and the hide of `kept` arrives, both behind an expired cursor.
  cloud.workspace(W1).hides = [];
  cloud.hide(W1, kept.id);
  cloud.failNext(HIDES, { status: 410, code: "SHARED_DICTIONARY_CURSOR_EXPIRED" });
  const hidesBefore = cloud.requestsTo(HIDES).length;
  await service.syncSharedDictionaryNow();

  const [expired, snapshot] = cloud.requestsTo(HIDES).slice(hidesBefore).map(query);
  assert.ok(expired.since);
  assert.equal(snapshot.since, undefined);
  assert.equal(snapshot.cursor, undefined);
  assert.equal(db.callsNamed("replaceSharedDictionaryHides").length, 2);
  assert.equal(db.callsNamed("replaceSharedDictionary").length, 2, "entries re-snapshot too");
  assert.deepEqual((await db.api.getSharedDictionary(W1)).hiddenIds, [kept.id]);
  assert.deepEqual(ctx.hints().workspace, ["Orukeet"]);
});

test("a failed clear after NOT_MEMBER publishes empty hints instead of reloading", async (t) => {
  const ctx = await setup(t);
  const { cloud, db, service } = ctx;
  cloud.add(W1, ["Qdrant"]);
  await service.syncSharedDictionaryNow();
  const errors = t.mock.method(console, "error", () => {});
  harness.window.electronAPI.clearSharedDictionary = async () => {
    throw new Error("disk full");
  };
  cloud.failNext(LIST, { status: 404, code: "SHARED_DICTIONARY_NOT_MEMBER" });

  await service.syncSharedDictionaryNow();

  assert.equal(db.workspaces.get(W1).entries.size, 1, "the mirror could not be cleared");
  assert.deepEqual(ctx.hints(), { space: [], workspace: [] });
  assert.deepEqual(JSON.parse(harness.localStorage.getItem("sharedDictionaryHints")), {
    workspaceId: W1,
    space: [],
    workspace: [],
  });
  assert.equal(harness.localStorage.getItem(ENTRIES_CURSOR), null);
  assert.equal(errors.mock.callCount(), 1);
});

// --- personal shared_at (moved words) ----------------------------------------

function personalRow(overrides = {}) {
  return {
    id: 1,
    word: "Piha",
    source: "manual",
    client_dict_id: "client-piha",
    cloud_id: null,
    sync_status: "pending",
    deleted_at: null,
    shared_at: null,
    created_at: "2026-10-01 10:00:00",
    updated_at: "2026-10-01 10:00:00",
    ...overrides,
  };
}

async function setupPersonal(t, { pending = [], local = null, cloudEntries = [] } = {}) {
  const ctx = await setup(t);
  harness.enableSync();
  const sent = [];
  const upserted = [];
  const sharedCloud = ctx.cloud.cloudApiRequest;
  Object.assign(harness.window.electronAPI, {
    getPendingDictionary: async () => pending,
    getPendingDictionaryDeletes: async () => [],
    getDictionaryByClientId: async () => local,
    upsertDictionaryFromCloud: async (entry) => upserted.push(entry),
    markDictionarySynced: async () => ({ changes: 1 }),
    hardDeleteDictionary: async () => {},
    clearDictionaryCloudId: async () => {},
    broadcastDictionaryUpdated: async () => {},
    cloudApiRequest: async (request) => {
      if (request.path === "/api/dictionary/batch-create") {
        sent.push(...request.body.entries);
        const created = request.body.entries.map((entry, index) => ({
          ...entry,
          id: `cloud-${index}`,
        }));
        return { success: true, data: { created } };
      }
      if (request.path.startsWith("/api/dictionary/list")) {
        return { success: true, data: { entries: cloudEntries, hasMore: false } };
      }
      return sharedCloud(request);
    },
  });
  return { ...ctx, sent, upserted };
}

test("a moved word resends shared_at when pushed", async (t) => {
  const ctx = await setupPersonal(t, {
    pending: [
      personalRow({ shared_at: "2026-10-20T10:00:00.000Z" }),
      personalRow({ id: 2, word: "Biscuit", client_dict_id: "client-biscuit" }),
    ],
  });

  await ctx.service.syncDictionaryNow();

  assert.deepEqual(
    ctx.sent.map(({ word, shared_at }) => [word, shared_at]),
    [
      ["Piha", "2026-10-20T10:00:00.000Z"],
      ["Biscuit", null],
    ]
  );
});

test("a pull takes the cloud's shared_at for a row at the same version", async (t) => {
  const cloudRow = {
    id: "cloud-piha",
    client_dict_id: "client-piha",
    word: "Piha",
    source: "manual",
    deleted_at: null,
    shared_at: "2026-10-20T10:00:00.000Z",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
  };
  const synced = personalRow({ cloud_id: "cloud-piha", sync_status: "synced" });

  const ctx = await setupPersonal(t, { local: synced, cloudEntries: [cloudRow] });
  await ctx.service.syncDictionaryNow();
  assert.deepEqual(
    ctx.upserted.map((entry) => entry.shared_at),
    ["2026-10-20T10:00:00.000Z"]
  );

  // A pending local edit, or an API that predates shared_at, keeps the row.
  const pendingCtx = await setupPersonal(t, {
    local: { ...synced, sync_status: "pending" },
    cloudEntries: [cloudRow],
  });
  await pendingCtx.service.syncDictionaryNow();
  assert.equal(pendingCtx.upserted.length, 0);

  const { shared_at: _omitted, ...olderApiRow } = cloudRow;
  const olderCtx = await setupPersonal(t, { local: synced, cloudEntries: [olderApiRow] });
  await olderCtx.service.syncDictionaryNow();
  assert.equal(olderCtx.upserted.length, 0);
});

// Last: startAutoSync's subscription lives as long as the workspace store, so
// it would also fire in any test after this one.
test("changing the active workspace starts a shared pass for it", async (t) => {
  const ctx = await setup(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  // Keep startAutoSync's own first pass throttled; only the switch should sync.
  harness.localStorage.setItem("lastSyncedAt", new Date().toISOString());
  harness.localStorage.setItem("teamSpacesCapability.probedAt", new Date().toISOString());
  ctx.cloud.add(W2, ["Biscuit"]);
  ctx.service.startAutoSync();
  await flush();
  assert.equal(ctx.cloud.requestsTo(LIST).length, 0);

  ctx.useWorkspaceStore.getState().setActiveWorkspaceId(W2);
  for (let i = 0; i < 20 && ctx.hints().workspace.length === 0; i++) await flush();

  const lists = ctx.cloud.requestsTo(LIST);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].query.get("workspace_id"), W2);
  assert.deepEqual(ctx.hints().workspace, ["Biscuit"]);

  // Clearing the workspace is not a switch to sync.
  ctx.useWorkspaceStore.getState().setActiveWorkspaceId(null);
  await flush();
  assert.equal(ctx.cloud.requestsTo(LIST).length, 1);
});
