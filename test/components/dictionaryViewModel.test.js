const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPicker,
  defaultAddTarget,
  resolveSharedAccessState,
  rowsForList,
  shareTargetsFor,
  visiblePersonalWords,
} = require("../../src/components/dictionary/dictionaryViewModel.ts");

const ENGINEERING = "11111111-1111-4111-8111-111111111111";
const SALES = "22222222-2222-4222-8222-222222222222";

const t = (key, options = {}) =>
  key === "dictionary.shared.everyoneAt" ? `Everyone at ${options.workspace}` : key;

const workspace = (overrides = {}) => ({
  id: "ws",
  name: "Acme",
  plan: "business",
  status: "active",
  role: "member",
  ...overrides,
});

const entry = (cloudId, word, spaceId, overrides = {}) => ({
  cloudId,
  spaceId,
  word,
  addedByUserId: "u-ana",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const snapshot = (entries, overrides = {}) => ({
  entries,
  hiddenIds: [],
  meta: {
    scopes: [
      { space_id: null, name: "Acme", member_count: 12, word_count: 0 },
      { space_id: ENGINEERING, name: "Engineering", member_count: 5, word_count: 0 },
      { space_id: SALES, name: "Sales", member_count: 4, word_count: 0 },
    ],
    contributors: [
      { user_id: "u-ana", name: "Ana", is_member: true },
      { user_id: "u-bob", name: "Bob", is_member: false },
      { user_id: "u-me", name: "Me", is_member: true },
    ],
    paused: false,
    syncedAt: "2026-10-01T00:00:00.000Z",
  },
  ...overrides,
});

const rowInput = (overrides = {}) => ({
  personal: [],
  movedPersonal: [],
  snapshot: null,
  workspaceName: "Acme",
  currentUserId: "u-me",
  search: "",
  sort: "az",
  ...overrides,
});

const words = (rows) => rows.map((row) => row.word);

test("resolveSharedAccessState: capability, workspace, plan and the server's paused flag", () => {
  const base = {
    capabilityAvailable: true,
    workspace: workspace({ role: "owner" }),
    serverPaused: null,
  };
  assert.equal(resolveSharedAccessState({ ...base, capabilityAvailable: false }), "unavailable");
  assert.equal(resolveSharedAccessState({ ...base, workspace: null }), "noWorkspace");
  assert.equal(resolveSharedAccessState(base), "available");
  assert.equal(resolveSharedAccessState({ ...base, serverPaused: false }), "available");
});

test("paused workspace with words is paused, without words is upgradeAdmin", () => {
  const lapsed = workspace({ plan: "free", role: "owner" });
  const input = { capabilityAvailable: true, workspace: lapsed };
  assert.equal(resolveSharedAccessState({ ...input, serverPaused: true }), "paused");
  assert.equal(resolveSharedAccessState({ ...input, serverPaused: false }), "upgradeAdmin");
  assert.equal(resolveSharedAccessState({ ...input, serverPaused: null }), "upgradeAdmin");
});

test("upgrade state depends on whether the role can manage the workspace", () => {
  const input = { capabilityAvailable: true, serverPaused: null };
  const free = (role) => workspace({ plan: "free", role });
  assert.equal(resolveSharedAccessState({ ...input, workspace: free("owner") }), "upgradeAdmin");
  assert.equal(resolveSharedAccessState({ ...input, workspace: free("admin") }), "upgradeAdmin");
  assert.equal(resolveSharedAccessState({ ...input, workspace: free("member") }), "upgradeMember");
  assert.equal(
    resolveSharedAccessState({ ...input, workspace: workspace({ status: "past_due" }) }),
    "upgradeMember"
  );
});

test("buildPicker orders groups and counts applying words", () => {
  const snap = snapshot(
    [
      entry("e1", "Qdrant", null),
      entry("e2", "Kubernetes", ENGINEERING),
      entry("e3", "Quota", SALES),
      entry("e4", "Secret", SALES),
    ],
    { hiddenIds: ["e4"] }
  );
  const picker = buildPicker({
    personal: ["OpenWhispr", "kubernetes"],
    movedPersonal: [],
    snapshot: snap,
    workspaceName: "Acme",
    access: "available",
    t,
  });
  assert.deepEqual(
    picker.map((item) => [item.key, item.group, item.locked, item.count]),
    [
      ["all", "top", false, 4],
      ["personal", "top", false, 2],
      ["allShared", "shared", false, 3],
      ["workspace", "shared", false, 1],
      [`space:${ENGINEERING}`, "shared", false, 1],
      [`space:${SALES}`, "shared", false, 1],
      ["hidden", "bottom", false, 1],
    ]
  );
  assert.equal(picker[3].label, "Everyone at Acme");
  assert.equal(picker[4].label, "Engineering");
});

test("buildPicker locks the shared entries unless access is available", () => {
  for (const access of ["unavailable", "noWorkspace", "upgradeAdmin", "upgradeMember", "paused"]) {
    const picker = buildPicker({
      personal: ["a"],
      movedPersonal: [],
      snapshot: snapshot([entry("e1", "Qdrant", null)]),
      workspaceName: "Acme",
      access,
      t,
    });
    for (const item of picker) {
      assert.equal(item.locked, item.group !== "top", `${access}/${item.key}`);
    }
  }
});

test("owner not in a space gets no space entry", () => {
  const snap = snapshot([entry("e1", "Qdrant", null)]);
  snap.meta.scopes = snap.meta.scopes.filter((scope) => scope.space_id === null);
  const picker = buildPicker({
    personal: [],
    movedPersonal: [],
    snapshot: snap,
    workspaceName: "Acme",
    access: "available",
    t,
  });
  assert.deepEqual(
    picker.map((item) => item.key),
    ["all", "personal", "allShared", "workspace", "hidden"]
  );
});

test("buildPicker counts are null before the shared lists are read", () => {
  const picker = buildPicker({
    personal: ["a", "b"],
    movedPersonal: [],
    snapshot: null,
    workspaceName: "Acme",
    access: "noWorkspace",
    t,
  });
  assert.deepEqual(
    picker.map((item) => [item.key, item.count]),
    [
      ["all", 2],
      ["personal", 2],
      ["allShared", null],
      ["workspace", null],
      ["hidden", null],
    ]
  );
});

test("a moved word leaves Personal only while its shared copy exists", () => {
  const personal = ["Qdrant", "OpenWhispr"];
  const withCopy = snapshot([entry("e1", "qdrant", null)]);
  assert.deepEqual(visiblePersonalWords(personal, ["Qdrant"], withCopy), ["OpenWhispr"]);
  assert.deepEqual(visiblePersonalWords(personal, ["Qdrant"], snapshot([])), personal);
  assert.deepEqual(visiblePersonalWords(personal, ["Qdrant"], null), personal);
  // Not moved: a teammate's identical word never hides the user's own.
  assert.deepEqual(visiblePersonalWords(personal, [], withCopy), personal);
  // A hidden copy still counts: the server retires the fallback on hide.
  const hiddenCopy = snapshot([entry("e1", "Qdrant", null)], { hiddenIds: ["e1"] });
  assert.deepEqual(visiblePersonalWords(personal, ["Qdrant"], hiddenCopy), ["OpenWhispr"]);
});

test("the Personal list follows the moved-word rule", () => {
  const input = rowInput({ personal: ["Qdrant", "Zed"], movedPersonal: ["Qdrant"] });
  const withCopy = snapshot([entry("e1", "Qdrant", null)]);
  assert.deepEqual(words(rowsForList("personal", { ...input, snapshot: withCopy })), ["Zed"]);
  assert.deepEqual(words(rowsForList("personal", { ...input, snapshot: snapshot([]) })), [
    "Qdrant",
    "Zed",
  ]);
});

test("All words never lists a word twice", () => {
  const moved = rowsForList(
    "all",
    rowInput({
      personal: ["Qdrant"],
      movedPersonal: ["Qdrant"],
      snapshot: snapshot([entry("e1", "Qdrant", null)]),
    })
  );
  assert.equal(moved.length, 1);
  assert.equal(moved[0].kind, "shared");
  assert.equal(moved[0].badge, "Acme");

  const personalWins = rowsForList(
    "all",
    rowInput({
      personal: ["OpenWhispr"],
      snapshot: snapshot([entry("e1", "openwhispr", null)]),
    })
  );
  assert.equal(personalWins.length, 1);
  assert.equal(personalWins[0].kind, "personal");
  assert.equal(personalWins[0].word, "OpenWhispr");
  assert.equal(personalWins[0].badge, null);
});

test("All words: a space row beats a workspace row, hidden words are left out", () => {
  const rows = rowsForList(
    "all",
    rowInput({
      snapshot: snapshot(
        [
          entry("e1", "Qdrant", null),
          entry("e2", "QDRANT", ENGINEERING),
          entry("e3", "Secret", null),
        ],
        { hiddenIds: ["e3"] }
      ),
    })
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entryId, "e2");
  assert.equal(rows[0].badge, "Engineering");
});

test("All shared shows one row per list entry", () => {
  const rows = rowsForList(
    "allShared",
    rowInput({
      personal: ["Qdrant"],
      snapshot: snapshot(
        [
          entry("e1", "Qdrant", ENGINEERING),
          entry("e2", "Qdrant", SALES),
          entry("e3", "Qdrant", null),
          entry("e4", "Hidden", null),
        ],
        { hiddenIds: ["e4"] }
      ),
    })
  );
  assert.deepEqual(rows.map((row) => [row.entryId, row.badge]).sort(), [
    ["e1", "Engineering"],
    ["e2", "Sales"],
    ["e3", "Acme"],
  ]);
});

test("single lists show their own entries, attribution and no badge", () => {
  const snap = snapshot([
    entry("e1", "Mine", null, { addedByUserId: "u-me" }),
    entry("e2", "Theirs", null, { addedByUserId: "u-ana" }),
    entry("e3", "Gone", null, { addedByUserId: "u-bob" }),
    entry("e4", "Orphan", null, { addedByUserId: null }),
    entry("e5", "Elsewhere", ENGINEERING),
  ]);
  const rows = rowsForList("workspace", rowInput({ snapshot: snap }));
  assert.deepEqual(
    rows.map((row) => [row.word, row.attribution, row.badge]),
    [
      ["Gone", "former", null],
      ["Mine", "you", null],
      ["Orphan", "former", null],
      ["Theirs", { name: "Ana" }, null],
    ]
  );
  const space = rowsForList(`space:${ENGINEERING}`, rowInput({ snapshot: snap }));
  assert.deepEqual(words(space), ["Elsewhere"]);
});

test("former member attribution", () => {
  const snap = snapshot([
    entry("e1", "FromBob", null, { addedByUserId: "u-bob" }),
    entry("e2", "FromNobody", null, { addedByUserId: null }),
    entry("e3", "FromStranger", null, { addedByUserId: "u-unknown" }),
  ]);
  const rows = rowsForList("workspace", rowInput({ snapshot: snap }));
  assert.deepEqual(
    rows.map((row) => row.attribution),
    ["former", "former", "former"]
  );
});

test("hidden lists hidden entries only", () => {
  const snap = snapshot([entry("e1", "Shown", null), entry("e2", "Tucked", ENGINEERING)], {
    hiddenIds: ["e2"],
  });
  const rows = rowsForList("hidden", rowInput({ personal: ["Mine"], snapshot: snap }));
  assert.deepEqual(
    rows.map((row) => [row.word, row.entryId, row.badge]),
    [["Tucked", "e2", "Engineering"]]
  );
  assert.deepEqual(words(rowsForList("workspace", rowInput({ snapshot: snap }))), ["Shown"]);
  assert.deepEqual(words(rowsForList(`space:${ENGINEERING}`, rowInput({ snapshot: snap }))), []);
});

test("search is a case-insensitive substring match", () => {
  const rows = rowsForList(
    "all",
    rowInput({
      personal: ["OpenWhispr", "Supabase"],
      snapshot: snapshot([entry("e1", "Whisperer", null)]),
      search: " WHISP ",
    })
  );
  assert.deepEqual(words(rows), ["OpenWhispr", "Whisperer"]);
});

test("sort: a-z and z-a ignore case, newest and oldest use createdAt with personal rows last", () => {
  const snap = snapshot([
    entry("e1", "banana", null, { createdAt: "2026-10-02T00:00:00.000Z" }),
    entry("e2", "Apple", ENGINEERING, { createdAt: "2026-10-03T00:00:00.000Z" }),
    entry("e3", "cherry", SALES, { createdAt: "2026-10-01T00:00:00.000Z" }),
  ]);
  const run = (sort) =>
    words(rowsForList("all", rowInput({ personal: ["Zulu"], snapshot: snap, sort })));
  assert.deepEqual(run("az"), ["Apple", "banana", "cherry", "Zulu"]);
  assert.deepEqual(run("za"), ["Zulu", "cherry", "banana", "Apple"]);
  assert.deepEqual(run("newest"), ["Apple", "banana", "cherry", "Zulu"]);
  assert.deepEqual(run("oldest"), ["cherry", "banana", "Apple", "Zulu"]);
});

test("defaultAddTarget: the open list's target, else the last used one", () => {
  assert.equal(defaultAddTarget("personal", `${SALES}`), "personal");
  assert.equal(defaultAddTarget("workspace", "personal"), null);
  assert.equal(defaultAddTarget(`space:${ENGINEERING}`, "personal"), ENGINEERING);
  for (const list of ["all", "allShared", "hidden"]) {
    assert.equal(defaultAddTarget(list, SALES), SALES);
    assert.equal(defaultAddTarget(list, "personal"), "personal");
    assert.equal(defaultAddTarget(list, null), "personal");
  }
});

test("shareTargetsFor lists the workspace first, then spaces, with member counts", () => {
  const snap = snapshot([]);
  snap.meta.scopes.reverse();
  assert.deepEqual(shareTargetsFor(["Qdrant"], snap, "Acme"), [
    { target: null, label: "Acme", memberCount: 12, alreadyShared: false },
    { target: SALES, label: "Sales", memberCount: 4, alreadyShared: false },
    { target: ENGINEERING, label: "Engineering", memberCount: 5, alreadyShared: false },
  ]);
});

test("Already shared when the list has the word in another case", () => {
  const snap = snapshot([
    entry("e1", "qdrant", null),
    entry("e2", "Qdrant", ENGINEERING),
    entry("e3", "Kubernetes", ENGINEERING),
  ]);
  const byTarget = (given) =>
    Object.fromEntries(
      shareTargetsFor(given, snap, "Acme").map((item) => [String(item.target), item.alreadyShared])
    );
  assert.deepEqual(byTarget(["QDRANT"]), { null: true, [ENGINEERING]: true, [SALES]: false });
  // Every word must be there, not just one of them.
  assert.deepEqual(byTarget(["QDRANT", "Kubernetes"]), {
    null: false,
    [ENGINEERING]: true,
    [SALES]: false,
  });
  assert.deepEqual(byTarget([]), { null: false, [ENGINEERING]: false, [SALES]: false });
});
