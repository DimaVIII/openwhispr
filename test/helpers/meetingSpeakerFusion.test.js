const test = require("node:test");
const assert = require("node:assert/strict");

const { createMeetingSpeakerFusion } = require("../../src/helpers/meetingSpeakerFusion");

const T0 = 1_700_000_000_000;
const JANE = { id: "jane", name: "Jane Doe" };
const OMAR = { id: "omar", name: "Omar Haddad" };
const ME = { id: "me", name: "Gabe", isSelf: true };

// Plays the meeting app's speaking indicator: each turn is [speaking ids, from,
// to] in ms after T0, in order.
function highlight(fusion, turns, roster = [JANE, OMAR]) {
  for (const [ids, from, to] of turns) {
    fusion.recordAppState({ at: T0 + from, participants: roster, speakingIds: ids });
    fusion.recordAppState({ at: T0 + to, participants: roster, speakingIds: [] });
  }
}

function identify(fusion, speakerId, from, to, displayName = null) {
  return fusion.observeIdentification({
    speakerId,
    displayName,
    startTime: T0 + from,
    endTime: T0 + to,
  });
}

test("names an unnamed voice once its speech lines up with one participant", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 10_000]]);

  assert.equal(identify(fusion, "speaker_0", 0, 2_000), null);
  assert.equal(identify(fusion, "speaker_0", 2_500, 4_000), null);
  assert.deepEqual(identify(fusion, "speaker_0", 4_500, 6_000), {
    speakerId: "speaker_0",
    participantId: "jane",
    displayName: "Jane Doe",
  });
  // Named: later agreeing speech arrives with that name and changes nothing.
  assert.equal(identify(fusion, "speaker_0", 6_500, 8_000, "Jane Doe"), null);
});

test("re-identified growing windows of one utterance count each moment once", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 10_000]]);

  // The windows sum to 7.5 s but cover 3.5 s of speech: still under the floor.
  for (const end of [1_500, 2_500, 3_500]) {
    assert.equal(identify(fusion, "speaker_0", 0, end), null);
  }
  assert.equal(identify(fusion, "speaker_0", 0, 4_500)?.displayName, "Jane Doe");
});

test("never renames a voice another source already named", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 20_000]]);

  for (let at = 0; at < 18_000; at += 2_000) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500, "Bob (voice profile)"), null);
  }
});

test("lets go of a voice the user renames after the meeting app named it", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 30_000]]);
  identify(fusion, "speaker_0", 0, 2_000);
  assert.equal(identify(fusion, "speaker_0", 2_000, 5_000)?.displayName, "Jane Doe");

  for (let at = 5_000; at < 28_000; at += 2_000) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500, "Janie"), null);
  }
  assert.equal(fusion.summarize().namedClusters, 0);
});

test("crosstalk casts no vote", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane", "omar"], 0, 20_000]]);

  for (let at = 0; at < 18_000; at += 2_000) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500), null);
  }
});

test("a participant who stopped speaking collects no votes", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 1_000]]);

  for (let at = 1_500; at < 15_000; at += 2_000) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500), null);
  }
});

test("the user's own tile never names a remote voice", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["me"], 0, 20_000]], [ME, JANE]);

  for (let at = 0; at < 18_000; at += 2_000) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500), null);
  }
});

test("stays the user once marked, after the app stops marking them", () => {
  const fusion = createMeetingSpeakerFusion();
  fusion.recordAppState({ at: T0, participants: [ME, JANE], speakingIds: [] });
  // Zoom's home window closed: the user's tile is still there, unmarked.
  highlight(fusion, [[["me"], 0, 20_000]], [{ id: "me", name: "Gabe" }, JANE]);

  for (let at = 0; at < 18_000; at += 2_000) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500), null);
  }
});

test("a highlight that trails the audio lines up once its lag is compensated", () => {
  // Omar and Jane alternate 5 s turns; the app highlights each 1.5 s late, so
  // every turn of Jane's opens on Omar's still-lit tile.
  const audioTurns = [
    ["omar", 0],
    ["jane", 5_000],
    ["omar", 10_000],
    ["jane", 15_000],
    ["omar", 20_000],
    ["jane", 25_000],
  ];
  const run = (lagMs) => {
    const fusion = createMeetingSpeakerFusion({ lagMs });
    highlight(
      fusion,
      audioTurns.map(([id, from]) => [[id], from + 1_500, from + 6_500])
    );
    const namings = [];
    for (const [id, from] of audioTurns) {
      if (id !== "jane") continue;
      for (let at = from; at + 1_600 <= from + 5_000; at += 1_600) {
        const naming = identify(fusion, "speaker_1", at, at + 1_600);
        if (naming) namings.push(naming.displayName);
      }
    }
    return namings;
  };

  assert.deepEqual(run(1_500), ["Jane Doe"]);
  // Uncompensated, the late highlight splits the votes and nothing is named:
  // the failure mode is a missing label, never Omar's name on Jane's voice.
  assert.deepEqual(run(0), []);
});

test("moving a name to another participant needs a majority of the history", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [
    [["jane"], 0, 6_000],
    [["omar"], 10_000, 40_000],
  ]);
  identify(fusion, "speaker_0", 0, 2_500);
  assert.equal(identify(fusion, "speaker_0", 2_500, 5_000)?.displayName, "Jane Doe");

  // 6 s of Omar against 5 s of Jane is not a majority.
  for (let at = 10_000; at < 16_000; at += 1_500) {
    assert.equal(identify(fusion, "speaker_0", at, at + 1_500, "Jane Doe"), null);
  }
  let naming = null;
  for (let at = 16_000; at < 40_000 && !naming; at += 1_500) {
    naming = identify(fusion, "speaker_0", at, at + 1_500, "Jane Doe");
  }
  assert.deepEqual(naming, {
    speakerId: "speaker_0",
    participantId: "omar",
    displayName: "Omar Haddad",
  });
});

test("follows a participant's rename in the meeting app", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 5_000]]);
  assert.equal(identify(fusion, "speaker_0", 0, 4_500)?.displayName, "Jane Doe");

  const renamed = { id: "jane", name: "Jane D." };
  highlight(fusion, [[["jane"], 6_000, 12_000]], [renamed, OMAR]);
  assert.equal(identify(fusion, "speaker_0", 6_000, 7_500, "Jane Doe")?.displayName, "Jane D.");
  // The identifier keeps an utterance's first name until it ends; a window
  // still carrying the old name is the fusion's own, not another source's.
  assert.equal(identify(fusion, "speaker_0", 7_500, 9_000, "Jane Doe"), null);
  assert.equal(identify(fusion, "speaker_0", 9_000, 10_500, "Jane D."), null);
  assert.equal(fusion.summarize().namedClusters, 1);
});

test("merges carry votes to the kept voice", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 10_000]]);
  assert.equal(identify(fusion, "speaker_0", 0, 2_500), null);
  assert.equal(identify(fusion, "speaker_1", 3_000, 5_000), null);

  fusion.applyMerges([{ keep: "speaker_0", remove: "speaker_1", displayName: null }]);
  assert.equal(identify(fusion, "speaker_0", 5_000, 5_500)?.displayName, "Jane Doe");
});

test("a merge keeps the meeting app's name on the kept voice", () => {
  const fusion = createMeetingSpeakerFusion();
  highlight(fusion, [[["jane"], 0, 10_000]]);
  assert.equal(identify(fusion, "speaker_1", 0, 4_500)?.displayName, "Jane Doe");

  fusion.applyMerges([{ keep: "speaker_0", remove: "speaker_1", displayName: "Jane Doe" }]);
  assert.equal(identify(fusion, "speaker_0", 5_000, 6_500, "Jane Doe"), null);
  assert.deepEqual(fusion.summarize(), { participants: 2, votingClusters: 1, namedClusters: 1 });
});

test("ignores malformed states and windows", () => {
  const fusion = createMeetingSpeakerFusion();
  fusion.recordAppState({ at: Number.NaN, participants: [JANE], speakingIds: ["jane"] });
  fusion.recordAppState();
  assert.equal(fusion.observeIdentification({}), null);
  assert.equal(fusion.observeIdentification(), null);
  assert.equal(identify(fusion, "speaker_0", 0, 4_500), null);
});
