const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Runs the real mic alignment queue and strategy switch from ipcHandlers.js
// with only the echo detector and the stream dispatch replaced.
const source = fs.readFileSync(path.join(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8");
const start = source.indexOf("const flushPendingMeetingMicChunks =");
const end = source.indexOf("const processMeetingMicWithAec =", start);
assert.ok(start >= 0 && end > start, "alignment block not found in ipcHandlers.js");
const alignmentSource = source.slice(start, end);

function harness() {
  let now = 1_000_000;
  const dispatched = [];
  const context = {
    Date: { now: () => now },
    MEETING_MIC_REFERENCE_ALIGNMENT_MS: 320,
    meetingPendingMicChunks: [],
    meetingSystemAudioStrategy: null,
    meetingAecEnabled: false,
    meetingLocalMode: false,
    meetingEchoLeakDetector: { analyzeMicChunk: () => ({ shouldMute: false }) },
    dispatchMeetingAudioBuffer: (buffer, source) => dispatched.push(`${source}:${buffer}`),
  };
  vm.createContext(context);
  vm.runInContext(
    `${alignmentSource}
    globalThis.api = {
      needsAlignment: meetingMicNeedsReferenceAlignment,
      setStrategy: setMeetingSystemAudioStrategy,
      queueMic: (buffer) => {
        meetingPendingMicChunks.push({ buffer, queuedAt: Date.now() });
        flushPendingMeetingMicChunks();
      },
    };`,
    context
  );
  return {
    api: context.api,
    dispatched,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("mic waits for the reference when system audio is captured in main", () => {
  const { api } = harness();
  for (const strategy of ["native", "wasapi-loopback", "pipewire-loopback"]) {
    api.setStrategy(strategy);
    assert.equal(api.needsAlignment(), true, strategy);
  }
});

test("mic goes out unaligned for renderer loopback or no system audio", () => {
  const { api } = harness();
  for (const strategy of ["loopback", "unsupported", null, undefined]) {
    api.setStrategy(strategy);
    assert.equal(api.needsAlignment(), false, String(strategy));
  }
});

test("queued mic waits for the alignment window under a helper capture", () => {
  const { api, dispatched, advance } = harness();
  api.setStrategy("wasapi-loopback");

  api.queueMic("a");
  assert.deepEqual(dispatched, []);

  advance(320);
  api.queueMic("b");
  assert.deepEqual(dispatched, ["mic:a"]);
});

test("a capture that falls back releases the mic it was holding", () => {
  const { api, dispatched } = harness();
  api.setStrategy("wasapi-loopback");
  api.queueMic("a");
  api.queueMic("b");

  api.setStrategy("loopback");

  assert.deepEqual(dispatched, ["mic:a", "mic:b"]);
});
