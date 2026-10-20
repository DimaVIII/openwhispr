const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/dictionaryPromptCap.js");

test("formatDictionaryPrompt personal-only is unchanged", async () => {
  const { formatDictionaryPrompt } = await load();
  assert.equal(formatDictionaryPrompt([["a", "b"], [], []], 900), "a, b");
});

test("formatDictionaryPrompt drops lowest tier first and ends with the personal tier", async () => {
  const { formatDictionaryPrompt } = await load();
  const workspace = Array.from({ length: 300 }, (_, i) => `ws${String(i).padStart(8, "0")}`);
  const prompt = formatDictionaryPrompt([["Piha", "Biscuit"], [], workspace], 900);
  assert.ok(prompt.endsWith("Piha, Biscuit"));
  assert.ok(prompt.length <= 900);
  assert.ok(prompt.length > 800, "fills the budget with workspace words");
  const words = prompt.split(", ");
  assert.ok(words.indexOf("Piha") > words.findIndex((w) => w.startsWith("ws")));
  // Highest-priority workspace words are kept, in their own order.
  assert.equal(words[0], "ws00000000");
});

test("formatDictionaryPrompt keeps the higher tier last and drops whole words only", async () => {
  const { formatDictionaryPrompt } = await load();
  assert.equal(formatDictionaryPrompt([["P1"], ["S1"], ["W1"]], 100), "W1, S1, P1");
  // 9 chars fits "S1, P1" (6) plus nothing more; W1 is dropped, not truncated.
  assert.equal(formatDictionaryPrompt([["P1"], ["S1"], ["W1"]], 9), "S1, P1");
  assert.equal(formatDictionaryPrompt([["P1"], ["S1"], ["W1"]], 1), "");
});

test("formatDictionaryPrompt returns an empty string for empty tiers", async () => {
  const { formatDictionaryPrompt } = await load();
  assert.equal(formatDictionaryPrompt([[], [], []], 900), "");
});
