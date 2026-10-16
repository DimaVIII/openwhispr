const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEETING_APP_SPEAKER_BUNDLE_IDS,
  interpretMeetingAppSnapshot,
  parseZoomTileText,
  participantIdForName,
} = require("../../src/helpers/meetingAppSpeakerAdapters");

// Synthetic trees shaped like the documented Zoom client. Replace them with
// trimmed `macos-meeting-speaker-listener --dump` output once it's captured.
const WINDOW = [0, 0, 1600, 1000];
const node = (description, frame, role = "AXGroup") => ({ role, description, frame });
const zoom = (...windows) => ({ type: "snapshot", at: 1, bundleId: "us.zoom.xos", windows });
const meetingWindow = (...nodes) => ({ title: "Zoom Meeting", frame: WINDOW, nodes });
const gallery = (...labels) =>
  labels.map((label, index) =>
    node(label, [(index % 2) * 800, Math.floor(index / 2) * 500, 800, 500])
  );
const toolbar = [
  node("Mute", [20, 960, 60, 40], "AXButton"),
  node("Start Video", [90, 960, 60, 40], "AXButton"),
];

test("parses a tile label into name, self and status", () => {
  assert.deepEqual(parseZoomTileText("Jane Doe"), {
    name: "Jane Doe",
    isSelf: false,
    speaking: false,
    muted: false,
  });
  assert.deepEqual(parseZoomTileText("Gabe (Host, me), Computer audio muted"), {
    name: "Gabe",
    isSelf: true,
    speaking: false,
    muted: true,
  });
  assert.deepEqual(parseZoomTileText("Omar Haddad (Co-host), Talking"), {
    name: "Omar Haddad",
    isSelf: false,
    speaking: true,
    muted: false,
  });
  // "unmuted" contains "muted"; only whole status parts count.
  assert.equal(parseZoomTileText("Jane Doe, Computer audio unmuted").muted, false);
  // Only Zoom's own role annotations come off the name.
  assert.equal(parseZoomTileText("Jane (she/her)").name, "Jane (she/her)");
  assert.equal(parseZoomTileText("Jane Doe's screen"), null);
  assert.equal(parseZoomTileText(""), null);
  assert.equal(parseZoomTileText("x".repeat(81)), null);
});

test("ids normalize case and spacing", () => {
  assert.equal(participantIdForName("  Jane   DOE "), "jane doe");
});

test("a tile that says it's talking is the speaker", () => {
  const state = interpretMeetingAppSnapshot(
    zoom(meetingWindow(...gallery("Jane Doe", "Omar Haddad, Talking", "Gabe (me)"), ...toolbar))
  );

  assert.equal(state.strategy, "tile-status");
  assert.deepEqual(state.speakingIds, ["omar haddad"]);
  assert.deepEqual(state.participants, [
    { id: "jane doe", name: "Jane Doe", isSelf: false },
    { id: "omar haddad", name: "Omar Haddad", isSelf: false },
    { id: "gabe", name: "Gabe", isSelf: true },
  ]);
});

test("speaker view's large tile is the speaker, its thumbnail the same person", () => {
  const state = interpretMeetingAppSnapshot(
    zoom(
      meetingWindow(
        node("Jane Doe", [0, 120, 1600, 840]),
        node("Jane Doe", [0, 0, 200, 112]),
        node("Omar Haddad", [200, 0, 200, 112]),
        node("Gabe (me)", [400, 0, 200, 112]),
        ...toolbar
      )
    )
  );

  assert.equal(state.strategy, "speaker-view");
  assert.deepEqual(state.speakingIds, ["jane doe"]);
  assert.equal(state.participants.length, 3);
});

test("speaker view with a muted main tile names no speaker", () => {
  const state = interpretMeetingAppSnapshot(
    zoom(
      meetingWindow(
        node("Jane Doe, Computer audio muted", [0, 120, 1600, 840]),
        node("Omar Haddad", [200, 0, 200, 112])
      )
    )
  );

  assert.deepEqual(state.speakingIds, []);
  assert.equal(state.strategy, "none");
});

test("a small gallery without status says nothing about who talks", () => {
  const state = interpretMeetingAppSnapshot(
    zoom(meetingWindow(node("Jane Doe", [0, 0, 800, 900]), node("Omar Haddad", [800, 0, 800, 900])))
  );

  assert.deepEqual(state.speakingIds, []);
  assert.equal(state.strategy, "none");
  assert.equal(state.participants.length, 2);
});

test("the Talking label names the speaker, with or without a visible tile", () => {
  const withTile = interpretMeetingAppSnapshot(
    zoom(
      meetingWindow(
        ...gallery("Jane Doe", "Omar Haddad"),
        node("Talking: Omar Haddad", [600, 4, 300, 20], "AXStaticText")
      )
    )
  );
  assert.equal(withTile.strategy, "talking-label");
  assert.deepEqual(withTile.speakingIds, ["omar haddad"]);
  assert.equal(withTile.participants.length, 2);

  // Screen share: the shared screen fills the window and tiles are gone.
  const sharing = interpretMeetingAppSnapshot(
    zoom(
      meetingWindow(
        node("Jane Doe's screen", [0, 0, 1600, 1000]),
        node("Talking: Omar Haddad (Co-host)", [600, 4, 300, 20], "AXStaticText")
      )
    )
  );
  assert.deepEqual(sharing.speakingIds, ["omar haddad"]);
  assert.deepEqual(sharing.participants, [
    { id: "omar haddad", name: "Omar Haddad", isSelf: false },
  ]);
});

test("reads the window showing the most tiles, never list rows or buttons", () => {
  const home = {
    title: "Zoom Workplace",
    frame: WINDOW,
    nodes: [node("Upcoming meetings", [0, 0, 900, 600])],
  };
  const meeting = meetingWindow(
    ...gallery("Jane Doe", "Omar Haddad"),
    node("Priya Shah", [1200, 100, 380, 80], "AXRow"),
    ...toolbar
  );
  const state = interpretMeetingAppSnapshot(zoom(home, meeting));

  assert.deepEqual(
    state.participants.map((participant) => participant.id),
    ["jane doe", "omar haddad"]
  );
});

test("only apps with an adapter are read", () => {
  assert.ok(MEETING_APP_SPEAKER_BUNDLE_IDS.includes("us.zoom.xos"));
  const state = interpretMeetingAppSnapshot({
    bundleId: "com.example.other",
    windows: [meetingWindow(...gallery("Jane Doe, Talking"))],
  });
  assert.deepEqual(state, { participants: [], speakingIds: [], strategy: "none" });
  assert.deepEqual(interpretMeetingAppSnapshot(null).speakingIds, []);
});
