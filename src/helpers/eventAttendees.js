// ESM like calendarCacheWindow.js: shared with the renderer, where Vite only
// handles ESM source files; main-process CJS callers load it via Node's
// require(esm) with module-syntax detection.

/**
 * An event's attendees JSON for the note it creates, each attendee tagged with
 * the event (`addedByEvent`) so removing the event later takes them off again.
 */
export function tagEventAttendeesJson(attendeesJson, eventId) {
  if (!attendeesJson || !eventId) return attendeesJson || null;
  try {
    const attendees = JSON.parse(attendeesJson);
    if (!Array.isArray(attendees)) return attendeesJson;
    return JSON.stringify(
      attendees.map((attendee) =>
        attendee && typeof attendee === "object" ? { ...attendee, addedByEvent: eventId } : attendee
      )
    );
  } catch {
    return attendeesJson;
  }
}
