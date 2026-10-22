// Dictionary half of SyncService over a real DatabaseManager, with only the
// HTTP boundary faked. With no saved cursor, the first pull used to read the
// server's default list, ordered by (created_at, id), then continue it on the
// (updated_at, id) delta keyset from that page's last row. Every word created
// after the first page but last edited before that row was skipped, and the
// cursor saved at the end kept it skipped on every later pass.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDb } = require("./harness/db.js");
const {
  installBrowserGlobals,
  resetBrowserGlobals,
  enableSync,
  establishValidatedAuth,
  stopSyncTimers,
  localStorage: localStorageStub,
  window: windowStub,
} = require("./harness/browserGlobals.js");
const { createElectronApi } = require("./harness/electronApiBridge.js");
const { createFakeCloud } = require("./harness/fakeCloud.js");
const { SyncService } = require("../../src/services/SyncService.ts");

// One more page than the 200-word pull batch holds.
const WORD_COUNT = 250;
const EDITED_LAST = 199;
const T0 = Date.parse("2026-10-18T09:00:00.000Z");
const minute = (n) => new Date(T0 + n * 60_000).toISOString();

async function setup(t) {
  const db = createDb(t);
  if (!db) return null;
  resetBrowserGlobals();
  installBrowserGlobals();
  enableSync();
  const cloud = createFakeCloud();
  windowStub.electronAPI = createElectronApi(db, { cloud });
  await establishValidatedAuth();
  const service = new SyncService();
  t.after(() => stopSyncTimers(service));
  return { db, cloud, service };
}

function seedWords(cloud, stamp) {
  return Array.from({ length: WORD_COUNT }, (_, i) =>
    cloud.seedDictionaryEntry({ word: `word-${i}`, ...stamp(i) })
  );
}

// Words created a minute apart, then the 200th-created, the last row of the
// first page, edited after every create: it holds the newest updated_at.
const editedAfterCreates = (i) => ({
  created_at: minute(i),
  updated_at: minute(i === EDITED_LAST ? WORD_COUNT : i),
});

const listQueries = (cloud) =>
  cloud
    .logFor("/api/dictionary/list")
    .map((call) => new URLSearchParams(call.path.split("?")[1] ?? ""));

test("a fresh device pulls every word when the newest edit ends the first page", async (t) => {
  const ctx = await setup(t);
  if (!ctx) return;
  const { db, cloud, service } = ctx;
  const words = seedWords(cloud, editedAfterCreates);

  await service.syncAll(true);

  assert.equal(db.getDictionary().length, WORD_COUNT, "every cloud word reaches the device");
  assert.equal(localStorageStub.getItem("lastSyncedAt.dictionary"), words[EDITED_LAST].updated_at);
  assert.equal(localStorageStub.getItem("lastSyncedAt.dictionary.id"), words[EDITED_LAST].id);
});

test("a fresh device pages a bulk import that shares one timestamp by id", async (t) => {
  const ctx = await setup(t);
  if (!ctx) return;
  const { db, cloud, service } = ctx;
  seedWords(cloud, () => ({ created_at: minute(0), updated_at: minute(0) }));

  await service.syncAll(true);

  assert.equal(db.getDictionary().length, WORD_COUNT, "every imported word reaches the device");
});

test("the pass after a first pull streams changes from its newest word", async (t) => {
  const ctx = await setup(t);
  if (!ctx) return;
  const { db, cloud, service } = ctx;
  const words = seedWords(cloud, editedAfterCreates);
  await service.syncAll(true);
  const firstPassCalls = listQueries(cloud).length;

  // Another device adds one word and deletes another after that pull.
  cloud.setClock(() => minute(WORD_COUNT + 10));
  cloud.seedDictionaryEntry({ word: "added-later" });
  await cloud.request({
    method: "DELETE",
    path: "/api/dictionary/delete",
    body: { id: words[0].id },
  });
  await service.syncAll(true);

  const [delta, ...rest] = listQueries(cloud).slice(firstPassCalls);
  assert.equal(rest.length, 0, "both changes fit one delta page");
  assert.equal(delta.get("since"), words[EDITED_LAST].updated_at);
  assert.equal(delta.get("since_id"), words[EDITED_LAST].id);
  const local = db.getDictionary();
  assert.equal(local.length, WORD_COUNT);
  assert.ok(local.includes("added-later"), "the new word arrives");
  assert.ok(!local.includes(words[0].word), "the tombstone removes the deleted word");
});
