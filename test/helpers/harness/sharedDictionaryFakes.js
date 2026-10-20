// In-memory stand-ins for the shared dictionary's two boundaries: the main
// process mirror (window.electronAPI's shared-dictionary IPC, with the same
// write rules as DatabaseManager) and the /api/shared-dictionary routes (with
// the API's snapshot and delta paging).

const { deferred } = require("./deferred.js");

const WORKSPACE_SCOPE = { space_id: null, name: "Workspace", member_count: 3, word_count: 0 };

function spaceScope(spaceId, name = spaceId) {
  return { space_id: spaceId, name, member_count: 2, word_count: 0 };
}

// --- main-process mirror -----------------------------------------------------

function createSharedDictionaryDb() {
  const workspaces = new Map();
  const calls = [];

  const forWorkspace = (workspaceId) => {
    let ws = workspaces.get(workspaceId);
    if (!ws) {
      ws = { entries: new Map(), hides: new Map(), meta: null };
      workspaces.set(workspaceId, ws);
    }
    return ws;
  };

  const sameEntry = (a, b) =>
    a.spaceId === b.spaceId &&
    a.word === b.word &&
    a.addedByUserId === b.addedByUserId &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt;

  function upsert(ws, entry) {
    if (entry.deleted_at) return remove(ws, entry.id);
    const next = {
      cloudId: entry.id,
      spaceId: entry.space_id ?? null,
      word: entry.word.trim(),
      addedByUserId: entry.added_by_user_id ?? null,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    };
    const prev = ws.entries.get(entry.id);
    if (prev && sameEntry(prev, next)) return 0;
    ws.entries.set(entry.id, next);
    return 1;
  }

  function remove(ws, id) {
    ws.hides.delete(id);
    return ws.entries.delete(id) ? 1 : 0;
  }

  function writeMeta(ws, meta) {
    ws.meta = {
      scopes: meta.scopes,
      contributors: meta.contributors,
      paused: meta.paused,
      syncedAt: new Date().toISOString(),
    };
  }

  function dropOrphanHides(ws) {
    for (const id of ws.hides.keys()) if (!ws.entries.has(id)) ws.hides.delete(id);
  }

  const api = {
    getSharedDictionary: async (workspaceId) => {
      const ws = workspaces.get(workspaceId) ?? {
        entries: new Map(),
        hides: new Map(),
        meta: null,
      };
      const entries = [...ws.entries.values()].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.cloudId.localeCompare(b.cloudId)
          : a.createdAt.localeCompare(b.createdAt)
      );
      return {
        entries: entries.map((entry) => ({ ...entry })),
        hiddenIds: [...ws.hides.keys()].sort(),
        meta: ws.meta ? structuredClone(ws.meta) : null,
      };
    },
    applySharedDictionaryPull: async (workspaceId, { upserts = [], deletedIds = [], meta }) => {
      calls.push({ name: "applySharedDictionaryPull", workspaceId, upserts, deletedIds, meta });
      const ws = forWorkspace(workspaceId);
      let changed = 0;
      for (const entry of upserts) changed += upsert(ws, entry);
      for (const id of deletedIds) changed += remove(ws, id);
      if (meta !== undefined) {
        writeMeta(ws, meta);
        const allowed = new Set(meta.scopes.map((s) => s.space_id).filter(Boolean));
        for (const entry of [...ws.entries.values()]) {
          if (entry.spaceId !== null && !allowed.has(entry.spaceId)) {
            changed += remove(ws, entry.cloudId);
          }
        }
        dropOrphanHides(ws);
      }
      return { changed };
    },
    replaceSharedDictionary: async (workspaceId, { entries = [], meta }) => {
      calls.push({ name: "replaceSharedDictionary", workspaceId, entries, meta });
      const ws = forWorkspace(workspaceId);
      const incoming = new Set(entries.filter((e) => !e.deleted_at).map((e) => e.id));
      let changed = 0;
      for (const id of [...ws.entries.keys()]) {
        if (!incoming.has(id)) changed += remove(ws, id);
      }
      for (const entry of entries) changed += upsert(ws, entry);
      writeMeta(ws, meta);
      dropOrphanHides(ws);
      return { changed };
    },
    applySharedDictionaryHides: async (workspaceId, { hidden = [], unhidden = [] }) => {
      calls.push({ name: "applySharedDictionaryHides", workspaceId, hidden, unhidden });
      const ws = forWorkspace(workspaceId);
      let changed = 0;
      for (const hide of hidden) {
        if (ws.hides.get(hide.entryId) === hide.updatedAt) continue;
        ws.hides.set(hide.entryId, hide.updatedAt);
        changed += 1;
      }
      for (const id of unhidden) if (ws.hides.delete(id)) changed += 1;
      return { changed };
    },
    replaceSharedDictionaryHides: async (workspaceId, hidden = []) => {
      calls.push({ name: "replaceSharedDictionaryHides", workspaceId, hidden });
      const ws = forWorkspace(workspaceId);
      ws.hides = new Map(hidden.map((hide) => [hide.entryId, hide.updatedAt]));
    },
    clearSharedDictionary: async (workspaceId) => {
      calls.push({ name: "clearSharedDictionary", workspaceId });
      if (workspaceId == null) workspaces.clear();
      else workspaces.delete(workspaceId);
    },
    getMovedDictionaryWords: async () => [],
  };

  // Seeds a mirror as if an earlier pass had written it.
  function seed(workspaceId, { entries = [], hidden = [], scopes = [WORKSPACE_SCOPE] } = {}) {
    const ws = forWorkspace(workspaceId);
    for (const entry of entries) upsert(ws, entry);
    for (const id of hidden) ws.hides.set(id, "2026-10-20T00:00:00.000Z");
    writeMeta(ws, { scopes, contributors: [], paused: false });
  }

  const callsNamed = (name) => calls.filter((call) => call.name === name);

  return { api, seed, calls, callsNamed, workspaces };
}

// --- cloud ---------------------------------------------------------------------

let entrySeq = 0;

// Without explicit stamps, an entry is written one second after the previous
// one, starting at `after`.
function cloudEntry(workspaceId, word, overrides = {}, after = "2026-10-20T09:00:00.000Z") {
  entrySeq += 1;
  const stamp = new Date(Date.parse(after) + entrySeq * 1000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(entrySeq).padStart(12, "0")}`,
    workspace_id: workspaceId,
    space_id: null,
    word,
    added_by_user_id: "user-teammate",
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
    ...overrides,
  };
}

const byKeys = (a, b, first, second) =>
  a[first] === b[first] ? a[second].localeCompare(b[second]) : a[first].localeCompare(b[first]);

function page(rows, limit) {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

function createSharedDictionaryCloud() {
  const workspaces = new Map();
  const requests = [];
  // path -> queue of { status, code } failures or deferreds, consumed in order.
  const interceptors = new Map();
  let serverTime = "2026-10-20T12:00:00.000Z";

  const forWorkspace = (workspaceId) => {
    let ws = workspaces.get(workspaceId);
    if (!ws) {
      ws = { entries: [], hides: [], scopes: [WORKSPACE_SCOPE], paused: false };
      workspaces.set(workspaceId, ws);
    }
    return ws;
  };

  function listEntries(ws, query) {
    const limit = Number(query.get("limit") ?? 200);
    const since = query.get("since");
    const sinceId = query.get("since_id");
    const cursor = query.get("cursor");
    const cursorId = query.get("cursor_id");
    let rows;
    if (since) {
      rows = ws.entries
        .filter((e) =>
          sinceId
            ? e.updated_at > since || (e.updated_at === since && e.id > sinceId)
            : e.updated_at >= since
        )
        .sort((a, b) => byKeys(a, b, "updated_at", "id"));
    } else {
      rows = ws.entries
        .filter((e) => !e.deleted_at)
        .filter((e) =>
          !cursor
            ? true
            : cursorId
              ? e.created_at > cursor || (e.created_at === cursor && e.id > cursorId)
              : e.created_at >= cursor
        )
        .sort((a, b) => byKeys(a, b, "created_at", "id"));
    }
    const { items, hasMore } = page(rows, limit);
    return {
      entries: structuredClone(items),
      hasMore,
      scopes: structuredClone(ws.scopes),
      contributors: [],
      paused: ws.paused,
      server_time: serverTime,
    };
  }

  function listHides(ws, query) {
    const limit = Number(query.get("limit") ?? 200);
    const since = query.get("since");
    const sinceId = query.get("since_id");
    const cursor = query.get("cursor");
    const cursorId = query.get("cursor_id");
    let rows;
    if (since) {
      rows = ws.hides.filter((h) =>
        sinceId
          ? h.updated_at > since || (h.updated_at === since && h.entry_id > sinceId)
          : h.updated_at >= since
      );
    } else {
      rows = ws.hides
        .filter((h) => !h.deleted_at)
        .filter((h) =>
          !cursor
            ? true
            : cursorId
              ? h.updated_at > cursor || (h.updated_at === cursor && h.entry_id > cursorId)
              : h.updated_at >= cursor
        );
    }
    rows.sort((a, b) => byKeys(a, b, "updated_at", "entry_id"));
    const { items, hasMore } = page(rows, limit);
    return { hides: structuredClone(items), hasMore, server_time: serverTime };
  }

  async function cloudApiRequest({ method, path }) {
    const url = new URL(path, "https://api.openwhispr.test");
    const query = url.searchParams;
    const request = { method, pathname: url.pathname, query };
    requests.push(request);
    // Lets a test change server state between the pages of one pass.
    fake.beforeServe?.(request);
    const queue = interceptors.get(url.pathname);
    const next = queue?.shift();
    if (next?.promise) await next.promise;
    else if (next?.data) return { success: true, data: structuredClone(next.data) };
    else if (next) return { success: false, error: next.code ?? "failed", ...next };

    if (url.pathname === "/api/shared-dictionary/list") {
      return { success: true, data: listEntries(forWorkspace(query.get("workspace_id")), query) };
    }
    if (url.pathname === "/api/shared-dictionary/hides") {
      return { success: true, data: listHides(forWorkspace(query.get("workspace_id")), query) };
    }
    return { success: false, status: 404, error: "Not found" };
  }

  const fake = {
    beforeServe: null,
    cloudApiRequest,
    requests,
    workspace: forWorkspace,
    // Adds live entries to a workspace's server lists, written after the
    // current server time unless `overrides` says otherwise.
    add(workspaceId, words, overrides = {}) {
      const rows = words.map((word) => cloudEntry(workspaceId, word, overrides, serverTime));
      forWorkspace(workspaceId).entries.push(...rows);
      return rows;
    },
    hide(workspaceId, entryId, updatedAt = serverTime) {
      forWorkspace(workspaceId).hides.push({
        entry_id: entryId,
        workspace_id: workspaceId,
        updated_at: updatedAt,
        deleted_at: null,
      });
    },
    setServerTime(value) {
      serverTime = value;
    },
    // The next request to `pathname` answers with this error instead.
    failNext(pathname, { status, code }) {
      const queue = interceptors.get(pathname) ?? [];
      queue.push({ status, code });
      interceptors.set(pathname, queue);
    },
    // The next request to `pathname` answers with exactly this body.
    respondNext(pathname, data) {
      const queue = interceptors.get(pathname) ?? [];
      queue.push({ data });
      interceptors.set(pathname, queue);
    },
    // The next request to `pathname` waits until the returned resolve() runs.
    holdNext(pathname) {
      const gate = deferred();
      const queue = interceptors.get(pathname) ?? [];
      queue.push(gate);
      interceptors.set(pathname, queue);
      return gate.resolve;
    },
    requestsTo(pathname) {
      return requests.filter((request) => request.pathname === pathname);
    },
  };
  return fake;
}

module.exports = {
  WORKSPACE_SCOPE,
  spaceScope,
  cloudEntry,
  createSharedDictionaryDb,
  createSharedDictionaryCloud,
};
