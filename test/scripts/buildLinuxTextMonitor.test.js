const test = require("node:test");
const assert = require("node:assert/strict");

const { DOWNLOADED_MARKER, isBinaryUpToDate } = require("../../scripts/build-linux-text-monitor");

const state = (overrides) => ({
  binaryExists: true,
  sourceExists: true,
  savedHash: "abc",
  currentHash: "abc",
  canCompile: true,
  ...overrides,
});

test("a compiled binary is current only while its source hash matches", () => {
  assert.equal(isBinaryUpToDate(state()), true);
  assert.equal(isBinaryUpToDate(state({ currentHash: "def" })), false);
  assert.equal(isBinaryUpToDate(state({ binaryExists: false })), false);
});

// linux-text-monitor-v1.0.0 predated --probe-editable, yet every Linux build
// shipped it: the download ran first and was never checked against the source.
test("a downloaded binary is replaced as soon as the source can be compiled", () => {
  assert.equal(isBinaryUpToDate(state({ savedHash: DOWNLOADED_MARKER })), false);
  assert.equal(isBinaryUpToDate(state({ savedHash: DOWNLOADED_MARKER, canCompile: false })), true);
});

// The old check stamped the current hash onto a binary with none, so a stale
// download read as freshly built from then on.
test("a binary with no recorded hash is rebuilt", () => {
  assert.equal(isBinaryUpToDate(state({ savedHash: null })), false);
  assert.equal(isBinaryUpToDate(state({ savedHash: null, canCompile: false })), false);
});

test("a binary with no source beside it is kept", () => {
  assert.equal(isBinaryUpToDate(state({ sourceExists: false, savedHash: null })), true);
});
