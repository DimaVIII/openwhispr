const assert = require("node:assert/strict");
const test = require("node:test");
const { mountSettingsPanel } = require("../lib/settingsPanelHarness");

const PANEL = "/components/OpenAICompatiblePanel.tsx";
const ENDPOINT = "reasoning.custom.endpointTitle";
const OPTIONAL_KEY = "reasoning.custom.apiKeyOptional";
const BASE = "http://127.0.0.1:11434/v1";
const KEYLESS_REFUSAL = { success: false, errorCode: "credentialsRejected", status: 401 };
const props = (overrides = {}) => ({
  baseUrl: BASE,
  setBaseUrl() {},
  apiKey: "",
  setApiKey() {},
  model: "",
  setModel() {},
  ...overrides,
});
// The panel's own model-list load uses the renderer's fetch.
const respond = (status, body = {}) => async () => ({
  ok: status === 200,
  status,
  statusText: "",
  json: async () => body,
  text: async () => "",
});
const modelList = respond(200, { data: [{ id: "llama-test" }] });
const listError = (panel) =>
  panel.find((node) => node.props?.className === "text-xs text-destructive")[0];
const mount = (t, { overrides, ...options } = {}) =>
  mountSettingsPanel(t, { module: PANEL, props: props(overrides), fetch: modelList, ...options });

test("an applied address is checked at once; its field holds the status", async (t) => {
  const panel = await mount(t);
  await panel.wait(0);
  assert.deepEqual(panel.requests(), [
    { scope: "reasoning", provider: "custom", baseUrl: BASE, apiKey: "" },
  ]);
  assert.ok(panel.field(ENDPOINT).props.check);
  assert.equal(panel.field(OPTIONAL_KEY).props.check, undefined);
  await panel.answer({ success: true });
  assert.equal(panel.field(ENDPOINT).props.check.phase, "connected");
});

test("a new address waits until the field is left; a window switch applies nothing", async (t) => {
  const applied = [];
  const panel = await mount(t, { overrides: { setBaseUrl: (value) => applied.push(value) } });
  await panel.wait(0);
  await panel.answer({ success: true });
  await panel.type(ENDPOINT, "http://127.0.0.1:8080");
  assert.equal(panel.field(ENDPOINT).props.check.phase, "idle", "the old status leaves");
  await panel.blur(ENDPOINT, { windowSwitch: true });
  await panel.wait(2000);
  assert.deepEqual(applied, []);
  assert.equal(panel.requests().length, 1);
  await panel.blur(ENDPOINT);
  assert.deepEqual(applied, ["http://127.0.0.1:8080"]);
  await panel.setProps({ baseUrl: "http://127.0.0.1:8080" });
  await panel.wait(0); // leaving the field checks at once
  assert.equal(panel.requests().at(-1).baseUrl, "http://127.0.0.1:8080");
});

test("a server that refuses a keyless check says it wants a key", async (t) => {
  const panel = await mount(t);
  await panel.wait(0);
  await panel.answer(KEYLESS_REFUSAL);
  const unauthorized = "reasoning.custom.endpointUnauthorized";
  assert.equal(panel.field(ENDPOINT).props.failureReason, unauthorized);
  await panel.setProps({ apiKey: "sk-server" });
  await panel.wait(0);
  await panel.answer(KEYLESS_REFUSAL);
  assert.equal(panel.field(ENDPOINT).props.failureReason, undefined, "with a key, a rejection");
});

test("the list's error line gives way to the check's reason", async (t) => {
  const panel = await mount(t, { fetch: respond(401) });
  await panel.wait(0); // the list loads and the check goes out
  assert.equal(listError(panel), undefined, "nothing twice while the check runs");
  await panel.answer(KEYLESS_REFUSAL);
  assert.equal(listError(panel), undefined);
  await panel.retry();
  await panel.answer({ success: true });
  assert.ok(listError(panel), "a list that fails behind a passing check still says so");
});

test("an address without http:// or https:// keeps the list's message, unchecked", async (t) => {
  const panel = await mount(t, { overrides: { baseUrl: "localhost:11434/v1" } });
  await panel.wait(1000);
  assert.equal(panel.requests().length, 0);
  assert.equal(listError(panel).props.children, "reasoning.custom.endpointWithProtocol");
});

test("OpenRouter checks its key, which holds the status", async (t) => {
  const panel = await mount(t, {
    overrides: {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      lockedBaseUrl: true,
      apiKeyRequired: true,
      apiKey: "sk-or-saved",
    },
  });
  assert.equal(panel.field(ENDPOINT), undefined);
  await panel.wait(0);
  assert.deepEqual(
    panel.requests().map((config) => [config.provider, config.apiKey]),
    [["openrouter", "sk-or-saved"]]
  );
  assert.ok(panel.field("common.apiKey").props.check);
});

test("a hidden server panel sends nothing until it is shown", async (t) => {
  const panel = await mount(t, { visible: false });
  await panel.wait(5000);
  assert.equal(panel.requests().length, 0);
  await panel.setVisible(true);
  await panel.wait(0);
  assert.equal(panel.requests().length, 1);
});

test("a server key saves trimmed as it changes, and the address is checked again", async (t) => {
  const saved = [];
  const panel = await mount(t, { overrides: { setApiKey: (value) => saved.push(value) } });
  await panel.type(OPTIONAL_KEY, " sk-server ");
  assert.deepEqual(saved, ["sk-server"]);
  await panel.setProps({ apiKey: "sk-server" });
  await panel.wait(500); // the key still has focus, so the pause runs
  assert.deepEqual(panel.requests().map((config) => config.apiKey), ["sk-server"]);
});
