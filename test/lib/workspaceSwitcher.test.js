const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/workspaceSwitcher.ts");

const workspace = (id, role = "member") => ({ id, name: id, role });

const base = {
  isSignedIn: true,
  loaded: true,
  error: false,
  workspaces: [],
  activeWorkspaceId: null,
};

test("signed-out users get no switcher", async () => {
  const { resolveWorkspaceSwitcher } = await load();

  assert.deepEqual(resolveWorkspaceSwitcher({ ...base, isSignedIn: false }), { kind: "hidden" });
});

test("a list that hasn't arrived yet shows a placeholder", async () => {
  const { resolveWorkspaceSwitcher } = await load();

  assert.deepEqual(resolveWorkspaceSwitcher({ ...base, loaded: false }), { kind: "loading" });
});

test("a failed load is not mistaken for having no workspace", async () => {
  const { resolveWorkspaceSwitcher } = await load();

  assert.deepEqual(resolveWorkspaceSwitcher({ ...base, error: true }), { kind: "error" });
});

test("a cached list survives a failed refresh", async () => {
  const { resolveWorkspaceSwitcher } = await load();
  const acme = workspace("acme");

  assert.equal(
    resolveWorkspaceSwitcher({ ...base, error: true, workspaces: [acme] }).kind,
    "workspace"
  );
});

test("users in no workspace stay personal", async () => {
  const { resolveWorkspaceSwitcher } = await load();

  assert.deepEqual(resolveWorkspaceSwitcher(base), { kind: "personal" });
});

test("the active workspace is current", async () => {
  const { resolveWorkspaceSwitcher } = await load();
  const acme = workspace("acme");
  const beta = workspace("beta");

  const state = resolveWorkspaceSwitcher({
    ...base,
    workspaces: [acme, beta],
    activeWorkspaceId: "beta",
  });

  assert.equal(state.kind, "workspace");
  assert.equal(state.current, beta);
});

test("with no active workspace the first one is current, as in Settings", async () => {
  const { resolveWorkspaceSwitcher } = await load();
  const acme = workspace("acme");

  const state = resolveWorkspaceSwitcher({
    ...base,
    workspaces: [acme, workspace("beta")],
    activeWorkspaceId: "gone",
  });

  assert.equal(state.current, acme);
});

test("only owners and admins of the current workspace can invite from it", async () => {
  const { resolveWorkspaceSwitcher } = await load();
  const stateFor = (role) =>
    resolveWorkspaceSwitcher({
      ...base,
      workspaces: [workspace("acme", role)],
      activeWorkspaceId: "acme",
    });

  assert.equal(stateFor("owner").canInvite, true);
  assert.equal(stateFor("admin").canInvite, true);
  assert.equal(stateFor("member").canInvite, false);
});
