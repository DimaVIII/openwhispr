const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createEnterpriseAudioRequestResolver,
} = require("../../src/helpers/enterpriseAudioRuntime");

function setup(overrides = {}) {
  let binding = null;
  const identity = { accountId: "account-a", authGeneration: 1, signedIn: true };
  const calls = [];
  const request = createEnterpriseAudioRequestResolver({
    getIdentity: () => ({ ...identity }),
    getBinding: () => binding,
    setBinding: (next) => {
      binding = next;
    },
    getAuthHeaders: async () => ({ Authorization: "Bearer local-test" }),
    getWorkspaces: async () => {
      calls.push("membership");
      return [{ id: "workspace-a" }];
    },
    getConfig: async (input) => {
      calls.push("config");
      return {
        success: true,
        accountId: input.accountId,
        workspaceId: input.workspaceId,
        authGeneration: input.expectedAuthGeneration,
        config: { generation: 3, providers: [] },
      };
    },
    ...overrides,
  });
  return { request, identity, calls };
}

const context = { accountId: "account-a", workspaceId: "workspace-a", authGeneration: 1 };

test("cold meeting requests load authoritative membership and enterprise config before routing", async () => {
  const fixture = setup();
  const request = await fixture.request({}, context, true);
  assert.equal(request.workspaceId, "workspace-a");
  assert.deepEqual(fixture.calls, ["membership", "config"]);
  await fixture.request({}, { ...context, generation: 3 });
  assert.deepEqual(fixture.calls, ["membership", "config"]);
  await assert.rejects(fixture.request({}, { ...context, generation: 2 }), {
    code: "AUTH_CONTEXT_CHANGED",
  });
});

test("unknown or unresolved signed-in workspaces cannot take a personal meeting route", async () => {
  const fixture = setup();
  await assert.rejects(fixture.request({}, undefined, true), { code: "AUTH_CONTEXT_CHANGED" });
  await assert.rejects(fixture.request({}, { ...context, workspaceId: "other-workspace" }, true), {
    code: "AUTH_CONTEXT_CHANGED",
  });
  assert.equal(fixture.calls.includes("config"), false);
});

test("personal users without workspaces and signed-out guests retain personal routing", async () => {
  const fixture = setup({ getWorkspaces: async () => [] });
  assert.equal(await fixture.request({}, undefined, true), null);
  fixture.identity.signedIn = false;
  fixture.identity.accountId = null;
  assert.equal(await fixture.request({}, undefined, true), null);
});

test("identity changes during workspace lookup cannot install a stale binding", async () => {
  let finish;
  const fixture = setup({
    getWorkspaces: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = fixture.request({}, context, true);
  await new Promise(setImmediate);
  fixture.identity.authGeneration++;
  finish([{ id: "workspace-a" }]);
  await assert.rejects(pending, { code: "AUTH_CONTEXT_CHANGED" });
  assert.deepEqual(fixture.calls, []);
});

test("a workspace switch during lookup cannot replace the newer workspace binding", async () => {
  let finish;
  let revision = 1;
  const fixture = setup({
    getScopeRevision: () => revision,
    getWorkspaces: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = fixture.request({}, context, true);
  await new Promise(setImmediate);
  revision++;
  finish([{ id: "workspace-a" }]);
  await assert.rejects(pending, { code: "AUTH_CONTEXT_CHANGED" });
  assert.deepEqual(fixture.calls, []);
});
