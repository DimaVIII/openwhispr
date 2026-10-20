const test = require("node:test");
const assert = require("node:assert/strict");

const { tagEventAttendeesJson } = require("../../src/helpers/eventAttendees.js");

test("tagEventAttendeesJson tags every attendee with the event that added them", () => {
  const attendees = [
    { email: "dana@x.com", displayName: "Dana", responseStatus: "accepted", self: false },
    { email: "me@x.com", displayName: "Me", responseStatus: "accepted", self: true },
  ];

  assert.deepEqual(JSON.parse(tagEventAttendeesJson(JSON.stringify(attendees), "evt-1")), [
    { ...attendees[0], addedByEvent: "evt-1" },
    { ...attendees[1], addedByEvent: "evt-1" },
  ]);
});

test("tagEventAttendeesJson leaves missing or unreadable attendees as they are", () => {
  assert.equal(tagEventAttendeesJson(null, "evt-1"), null);
  assert.equal(tagEventAttendeesJson("[]", null), "[]");
  assert.equal(tagEventAttendeesJson("not json", "evt-1"), "not json");
  assert.equal(tagEventAttendeesJson('{"email":"a@x.com"}', "evt-1"), '{"email":"a@x.com"}');
});
