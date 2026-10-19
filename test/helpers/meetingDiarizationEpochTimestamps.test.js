const test = require("node:test");
const assert = require("node:assert/strict");

// diarization.js pulls in helpers that reach for electron at load time.
require.cache[require.resolve("electron")] = {
  exports: {
    app: {
      getPath: () => "/tmp",
      getAppPath: () => process.cwd(),
      isPackaged: false,
    },
    net: {},
  },
};

const DiarizationManager = require("../../src/helpers/diarization.js");
const { mergeTranscriptSegments } = require("../../src/utils/transcriptSpeakerState.ts");
const { withoutRemovedSegments } = require("../../src/utils/diarizationCompletion.ts");

// #2781: a few mic rows were saved with epoch-ms timestamps and no speaker.
// Live segments carry Date.now() timestamps; main normalizes them to seconds
// before mergeWithTranscript (ipcHandlers.js _startOrSkipDiarization), and the
// renderer merges main's result onto the transcript it persisted at stop.

const START_MS = 1792414000000;

// Mirrors _startOrSkipDiarization: normalize, split out echo duplicates, merge
// the rest, and report the duplicates with their raw timestamps.
const runMainDiarization = (mainSegments, retractedSegments = []) => {
  const manager = new DiarizationManager();
  const normalized = mainSegments.map((segment) => ({
    ...segment,
    timestamp: segment.timestamp != null ? (segment.timestamp - START_MS) / 1000 : undefined,
  }));
  const { kept, removed } = manager.splitMicEchoDuplicates(normalized);
  const removedSet = new Set(removed);
  const segments = manager.mergeWithTranscript(
    kept,
    [{ start: 0, end: 120, speaker: "speaker_00" }],
    { diarizedSource: "system" }
  );
  const removedSegments = [
    ...retractedSegments,
    ...mainSegments.filter((_, index) => removedSet.has(normalized[index])),
  ].map(({ text, source, timestamp }) => ({ text, source, timestamp }));
  return { segments, removedSegments };
};

// Mirrors the renderer's meeting-diarization-complete listener.
const runRendererCompletion = (persisted, { segments, removedSegments }) =>
  mergeTranscriptSegments(
    withoutRemovedSegments(persisted, removedSegments),
    segments.map((segment, index) => ({ ...segment, id: `diarized-${index}` }))
  );

const assertNoEpochTimestamps = (segments) => {
  for (const segment of segments) {
    assert.ok(
      segment.timestamp == null || segment.timestamp < 1e9,
      `segment "${segment.text}" (${segment.source}) kept epoch timestamp ${segment.timestamp}`
    );
  }
};

test("a bleed-flagged mic segment that duplicates system text never keeps its epoch timestamp", () => {
  const echoed = "let's ship the pricing page on friday";
  const live = [
    { id: "seg-1", source: "mic", text: "morning everyone", timestamp: START_MS + 2000 },
    { id: "seg-2", source: "system", text: echoed, timestamp: START_MS + 10000 },
    // Released after holdback with no live match, then confirmed as echo by
    // the post-session dedupe in mergeWithTranscript.
    {
      id: "seg-3",
      source: "mic",
      text: echoed,
      timestamp: START_MS + 11000,
      hasBleedEvidence: true,
    },
  ];

  const persisted = live;
  const mainSegments = live.map(({ id: _id, ...segment }) => segment);
  const merged = runRendererCompletion(persisted, runMainDiarization(mainSegments));

  assertNoEpochTimestamps(merged);
  assert.equal(merged.filter((segment) => segment.text === echoed).length, 1);
  assert.ok(merged.every((segment) => segment.speaker));
});

test("a mic segment retracted after the renderer stopped listening is removed from the note", () => {
  const racing = "sounds good to me";
  const persisted = [
    { id: "seg-1", source: "system", text: "any objections", timestamp: START_MS + 1000 },
    { id: "seg-2", source: "mic", text: racing, timestamp: START_MS + 4000 },
  ];
  // During disconnect a system final retracted seg-2 in main; the retract
  // event arrived after the renderer's stop and was ignored.
  const mainSegments = [
    { source: "system", text: "any objections", timestamp: START_MS + 1000 },
    { source: "system", text: racing, timestamp: START_MS + 4500 },
  ];
  const retracted = [{ source: "mic", text: racing, timestamp: START_MS + 4000 }];

  const merged = runRendererCompletion(persisted, runMainDiarization(mainSegments, retracted));

  assertNoEpochTimestamps(merged);
  assert.deepEqual(
    merged.map((segment) => [segment.source, segment.text]),
    [
      ["system", "any objections"],
      ["system", racing],
    ]
  );
});

test("post-session mic dedupe only looks at system text within 6 seconds", () => {
  const manager = new DiarizationManager();
  const repeated = "can everyone see my screen";
  // Seconds from start: the mic line is said 10 minutes after the system one.
  const merged = manager.mergeWithTranscript(
    [
      { source: "system", text: repeated, timestamp: 30 },
      { source: "mic", text: repeated, timestamp: 630, hasBleedEvidence: true },
    ],
    [{ start: 0, end: 700, speaker: "speaker_00" }],
    { diarizedSource: "system" }
  );

  assert.equal(merged.filter((segment) => segment.source === "mic").length, 1);
});
