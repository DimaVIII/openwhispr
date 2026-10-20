const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/noteEventPicker.ts");

const iso = (...parts) => new Date(...parts).toISOString();

function event(id, start, end, overrides = {}) {
  return {
    id,
    calendar_id: "cal",
    provider: "google",
    summary: id,
    start_time: start,
    end_time: end,
    is_all_day: 0,
    status: "confirmed",
    attendees: null,
    ...overrides,
  };
}

test("eventsOnDay keeps overlapping timed and all-day events", async () => {
  const { eventsOnDay } = await load();
  const events = [
    event("morning", iso(2026, 9, 20, 10), iso(2026, 9, 20, 13)),
    event("late", iso(2026, 9, 20, 23, 30), iso(2026, 9, 21, 0, 30)),
    event("all-day", "2026-10-20", "2026-10-21", { is_all_day: 1 }),
    event("next-all-day", "2026-10-21", "2026-10-22", { is_all_day: 1 }),
    event("yesterday", iso(2026, 9, 19, 8), iso(2026, 9, 19, 9)),
  ];

  assert.deepEqual(
    eventsOnDay(events, new Date(2026, 9, 20, 13, 45)).map((e) => e.id),
    ["morning", "late", "all-day"]
  );
});

test("searchLinkableEvents matches titles and guests, nearest to the note first", async () => {
  const { searchLinkableEvents } = await load();
  const anchor = new Date(2026, 9, 20, 12);
  const events = [
    event("standup-old", iso(2026, 9, 17, 9), iso(2026, 9, 17, 10), { summary: "Team Standup" }),
    event("standup", iso(2026, 9, 20, 14), iso(2026, 9, 20, 15), { summary: "Team Standup" }),
    event("one-on-one", iso(2026, 9, 19, 9), iso(2026, 9, 19, 10), {
      summary: "1:1",
      attendees: JSON.stringify([{ email: "eve@x.com", displayName: "Eve" }]),
    }),
  ];

  assert.deepEqual(
    searchLinkableEvents(events, " team ", anchor).map((e) => e.id),
    ["standup", "standup-old"]
  );
  assert.deepEqual(
    searchLinkableEvents(events, "EVE@X", anchor).map((e) => e.id),
    ["one-on-one"]
  );
  assert.deepEqual(searchLinkableEvents(events, "  ", anchor), []);
});

test("searchLinkableEvents caps the results", async () => {
  const { searchLinkableEvents } = await load();
  const events = Array.from({ length: 80 }, (_, i) =>
    event(`e${i}`, iso(2026, 9, 20, 0, i), iso(2026, 9, 20, 1, i), { summary: "Sync" })
  );

  assert.equal(searchLinkableEvents(events, "sync", new Date(2026, 9, 20)).length, 50);
});

test("isBeforeStoredWindow", async () => {
  const { isBeforeStoredWindow } = await load();
  const now = new Date(2026, 9, 20, 12).getTime();

  assert.equal(isBeforeStoredWindow(new Date(2026, 9, 16, 9), now), true);
  assert.equal(isBeforeStoredWindow(new Date(2026, 9, 17, 9), now), false);
  assert.equal(isBeforeStoredWindow(new Date(2026, 9, 20, 9), now), false);
});
