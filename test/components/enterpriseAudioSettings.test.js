const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

function elements(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => elements(child, found));
  else if (node?.props) {
    found.push(node);
    elements(node.props.children, found);
  }
  return found;
}

test("equal-generation workspace changes clear credentials and consent and ignore stale setup responses", async (t) => {
  let root;
  t.after(() => root && React.act(async () => root.unmount()));
  const pending = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        enterpriseAudioStatus: (input) =>
          new Promise((resolve) => pending.push({ input, resolve })),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-enterprise-audio-settings-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": "const t=(key)=>key; export function useTranslation(){return {t};}",
    },
  });
  const { useEnterpriseIdentityStore: store } = await vite.ssrLoadModule(
    "/stores/enterpriseIdentityStore.ts"
  );
  const { EnterpriseAudioSettings } = await vite.ssrLoadModule(
    "/components/settings/EnterpriseAudioSettings.tsx"
  );
  const identity = (workspaceId) => ({
    accountId: "account-a",
    workspaceId,
    authGeneration: 1,
    config: {
      workspaceId,
      generation: 1,
      providers: [{ provider: "openai-compatible", version: 1, config: { batch: {} } }],
    },
  });
  store.setState(identity("workspace-a"));
  let tree;
  function Harness() {
    tree = EnterpriseAudioSettings();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const find = (predicate) => elements(tree).find(predicate);
  const password = () => find((node) => node.props.type === "password");
  const consent = () => find((node) => node.props.type === "checkbox");
  const status = {
    success: true,
    slots: [{ slot: "http", present: false }],
    operations: ["batch"],
    configFingerprint: "a".repeat(64),
  };
  await React.act(async () => pending[0].resolve(status));
  await React.act(async () => {
    password().props.onChange({ target: { value: "workspace-a-test-secret" } });
    consent().props.onChange({ target: { checked: true } });
  });
  assert.equal(password().props.value, "workspace-a-test-secret");
  assert.equal(consent().props.checked, true);
  await React.act(async () => store.setState(identity("workspace-b")));
  assert.equal(consent().props.checked, false);
  assert.equal(password(), undefined);
  assert.equal(pending[1].input.context.workspaceId, "workspace-b");
  await React.act(async () => store.setState(identity("workspace-c")));
  await React.act(async () => pending[1].resolve(status));
  assert.equal(password(), undefined);
  await React.act(async () => pending[2].resolve(status));
  assert.equal(password().props.value, "");
  assert.equal(consent().props.checked, false);
});
