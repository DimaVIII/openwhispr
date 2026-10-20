// Reads who is talking out of a meeting app's accessibility snapshot (emitted
// by resources/macos-meeting-speaker-listener.swift). Each adapter turns one
// app's tree into a roster plus the participants it shows as speaking;
// meetingSpeakerFusion.js matches those against the voices in the audio.
//
// Tile and speaker-view rules are checked against a `--dump` of Zoom 7.2.2 in
// speaker view (test/helpers/fixtures/zoom-7.2-speaker-view.json). Its tiles
// never said "Talking"; the tile-status and "Talking:" rules are still
// provisional until gallery view and screen sharing are dumped too. Meeting
// apps restyle their UI without notice, which is why the rules live here
// beside their tests rather than in the native helper.

const EMPTY_STATE = Object.freeze({ participants: [], speakingIds: [], strategy: "none" });

const MAX_NAME_LENGTH = 80;

const ZOOM_BUNDLE_IDS = ["us.zoom.xos"];
// Zoom 7.2's video tiles are AXTabGroups labelled "Name, Computer audio muted,
// Video on" (checked against --dump of 7.2.2). Matching the role keeps this
// independent of Zoom's UI language, and rules out the home window's web
// panels ("Zoom Calendar Sidebar"), which carry tile-sized labels too.
const ZOOM_TILE_ROLE = "AXTabGroup";
// Video tiles are at least thumbnail-sized.
const ZOOM_MIN_TILE_WIDTH = 120;
const ZOOM_MIN_TILE_HEIGHT = 68;
// Status parts that follow the name in a tile's label ("Jane Doe, Talking").
const ZOOM_SPEAKING_TOKENS = new Set(["talking", "speaking", "active speaker"]);
const ZOOM_MUTED_TOKENS = new Set([
  "muted",
  "audio muted",
  "computer audio muted",
  "microphone muted",
]);
// Zoom's role annotations after a name: "(Host)", "(Co-host)", "(Host, me)".
const ZOOM_ROLE_SUFFIX =
  /\s*\((?:host|co-host|guest|me)(?:\s*,\s*(?:host|co-host|guest|me))*\)\s*$/i;
// The header label Zoom shows over shared screens, where tiles shrink or vanish.
const ZOOM_TALKING_LABEL = /^talking:\s*(.+)$/i;
const ZOOM_SHARE_TILE = /screen shar|'s screen\b/i;
// Speaker view shows the active speaker over most of the window and everyone
// else as thumbnails. One tile that large is the app's own pick of speaker;
// two large tiles are a small gallery, which says nothing about who talks.
// Known cost: a pinned or spotlighted video looks the same and is read as the
// speaker for as long as it stays pinned.
const ZOOM_SPEAKER_VIEW_MIN_SHARE = 0.4;
const ZOOM_THUMBNAIL_MAX_SHARE = 0.15;

// Display names are the only identity the tree exposes. Known cost: two
// participants with the same name ("iPhone") read as one.
function participantIdForName(name) {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function nodeText(node) {
  return String(node?.description || node?.title || "").trim();
}

// Splits "Gabe (Host, me), Computer audio muted" at top-level commas only, so
// the role annotation stays with the name.
function splitLabelParts(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

function frameArea(frame) {
  const [, , width = 0, height = 0] = Array.isArray(frame) ? frame : [];
  return width > 0 && height > 0 ? width * height : 0;
}

function parseZoomName(rawName) {
  const roleMatch = rawName.match(ZOOM_ROLE_SUFFIX);
  const name = (roleMatch ? rawName.slice(0, roleMatch.index) : rawName).trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return { name, isSelf: !!roleMatch && /\bme\b/i.test(roleMatch[0]) };
}

function parseZoomTileText(text) {
  if (!text || ZOOM_SHARE_TILE.test(text)) return null;

  const [rawName, ...rawTokens] = splitLabelParts(text);
  const parsedName = parseZoomName(rawName);
  if (!parsedName) return null;

  const tokens = rawTokens.map((token) => token.toLowerCase());
  return {
    ...parsedName,
    speaking: tokens.some((token) => ZOOM_SPEAKING_TOKENS.has(token)),
    muted: tokens.some((token) => ZOOM_MUTED_TOKENS.has(token)),
  };
}

function collectZoomTiles(window) {
  const tiles = new Map();
  for (const node of window?.nodes || []) {
    const [, , width = 0, height = 0] = Array.isArray(node?.frame) ? node.frame : [];
    if (node?.role !== ZOOM_TILE_ROLE) continue;
    if (width < ZOOM_MIN_TILE_WIDTH || height < ZOOM_MIN_TILE_HEIGHT) continue;

    const parsed = parseZoomTileText(nodeText(node));
    if (!parsed) continue;

    // One person can show twice: speaker view's main video and its thumbnail.
    const id = participantIdForName(parsed.name);
    const area = width * height;
    const existing = tiles.get(id);
    tiles.set(id, {
      id,
      name: existing && existing.area >= area ? existing.name : parsed.name,
      isSelf: parsed.isSelf || !!existing?.isSelf,
      speaking: parsed.speaking || !!existing?.speaking,
      muted: parsed.muted || !!existing?.muted,
      area: Math.max(area, existing?.area ?? 0),
    });
  }
  return tiles;
}

// Tiles never mark the user, and the participants panel's "(Host, me)" is an
// AXValue, which snapshots leave out. The home window's profile button carries
// the signed-in name instead: "Zoom, Jane Doe, In a Zoom Meeting, Basic account".
function collectZoomSelfIds(windows) {
  const ids = new Set();
  for (const window of windows) {
    for (const node of window?.nodes || []) {
      if (node?.role !== "AXButton") continue;
      const [brand, rawName, ...status] = splitLabelParts(nodeText(node));
      if (brand !== "Zoom" || !rawName || !status.length) continue;
      const parsed = parseZoomName(rawName);
      if (parsed) ids.add(participantIdForName(parsed.name));
    }
  }
  return ids;
}

function collectZoomTalkingNames(windows) {
  const names = [];
  for (const window of windows) {
    for (const node of window?.nodes || []) {
      const match = nodeText(node).match(ZOOM_TALKING_LABEL);
      if (!match) continue;
      for (const rawName of splitLabelParts(match[1])) {
        const parsed = parseZoomName(rawName);
        if (parsed) names.push(parsed);
      }
    }
  }
  return names;
}

function interpretZoomSnapshot(snapshot) {
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];

  // The meeting window is the one showing the most participant tiles; this
  // avoids matching window titles, which Zoom localizes.
  let meeting = null;
  for (const window of windows) {
    const tiles = collectZoomTiles(window);
    if (!meeting || tiles.size > meeting.tiles.size) meeting = { window, tiles };
  }
  const tiles = meeting?.tiles ?? new Map();
  const selfIds = collectZoomSelfIds(windows);
  for (const tile of tiles.values()) {
    if (selfIds.has(tile.id)) tile.isSelf = true;
  }
  const participants = [...tiles.values()].map(({ id, name, isSelf }) => ({ id, name, isSelf }));

  const flagged = [...tiles.values()].filter((tile) => tile.speaking && !tile.muted);
  if (flagged.length) {
    return { participants, speakingIds: flagged.map((tile) => tile.id), strategy: "tile-status" };
  }

  const talking = collectZoomTalkingNames(windows);
  if (talking.length) {
    const speakingIds = [];
    for (const { name, isSelf } of talking) {
      const id = participantIdForName(name);
      if (tiles.get(id)?.muted || speakingIds.includes(id)) continue;
      if (!tiles.has(id)) participants.push({ id, name, isSelf: isSelf || selfIds.has(id) });
      speakingIds.push(id);
    }
    return { participants, speakingIds, strategy: "talking-label" };
  }

  const windowArea = frameArea(meeting?.window?.frame);
  const [main, runnerUp] = [...tiles.values()].sort((a, b) => b.area - a.area);
  if (
    main &&
    windowArea > 0 &&
    !main.muted &&
    main.area / windowArea >= ZOOM_SPEAKER_VIEW_MIN_SHARE &&
    (!runnerUp || runnerUp.area / windowArea <= ZOOM_THUMBNAIL_MAX_SHARE)
  ) {
    return { participants, speakingIds: [main.id], strategy: "speaker-view" };
  }

  return { participants, speakingIds: [], strategy: "none" };
}

const MEETING_APP_SPEAKER_ADAPTERS = [
  { app: "zoom", bundleIds: ZOOM_BUNDLE_IDS, interpret: interpretZoomSnapshot },
];

const MEETING_APP_SPEAKER_BUNDLE_IDS = MEETING_APP_SPEAKER_ADAPTERS.flatMap(
  (adapter) => adapter.bundleIds
);

// snapshot: { bundleId, windows: [{ frame, nodes: [{ role, title, description,
// frame }] }] }. Returns { participants, speakingIds, strategy }.
function interpretMeetingAppSnapshot(snapshot) {
  const adapter = MEETING_APP_SPEAKER_ADAPTERS.find((candidate) =>
    candidate.bundleIds.includes(snapshot?.bundleId)
  );
  return adapter ? adapter.interpret(snapshot) : EMPTY_STATE;
}

module.exports = {
  MEETING_APP_SPEAKER_BUNDLE_IDS,
  interpretMeetingAppSnapshot,
  interpretZoomSnapshot,
  parseZoomTileText,
  participantIdForName,
};
