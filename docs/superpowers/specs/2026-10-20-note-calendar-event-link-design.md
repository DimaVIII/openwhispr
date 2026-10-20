# Link a note to a calendar event — design

**Date:** 2026-10-20
**Status:** awaiting Josh's approval. Nothing is built until he approves the plan.
**Plan:** `docs/superpowers/plans/2026-10-20-note-calendar-event-link.md`
**Research:** `docs/superpowers/research/2026-10-20-note-calendar-event-link-research.md`. Its live-fetch recommendation (`listEvents`, day browsing, "Search older events") is **superseded** by Josh's 2026-10-20 decision to store 3 days locally (see Decision 1).
**Base:** `origin/main` @ `43db446e1`, branch `feat/note-calendar-event-link`.
**Reference:** Granola's note-header event popover, for look, feel and behaviour.

## The request

Josh: "Should be able to link an event from your calendar by searching manually."

Today a note gets a calendar event only when it's created from a meeting prompt or from Upcoming Meetings' "Join & transcribe". You can't attach an event afterwards, change it, or remove it. The note header shows the event's name as a read-only chip (`NoteEditor.tsx:1038`).

## What the user gets

The dropdown under the note header's date and attendees capsule (`NoteParticipants.tsx`, rendered at `NoteEditor.tsx:1032`) gets a calendar-event section above the attendee list. It looks the same in private notes and team notes, because it's the same component.

1. **Unlinked.** The top row reads **Select calendar event**, with the note's date and time underneath and a chevron. Below it are the "Add attendees…" input and the attendees grouped by domain, as today.
2. **Choosing.** Clicking the row swaps the dropdown to a list. It has a **Search event…** box with a back arrow, and below it the events on the note's day, each with its calendar's colour dot, its title and "Tue, Oct 20 · 10:00 AM – 1:00 PM" (or "All day"). Typing searches every stored event (about 3 days back through the stored lookahead), closest to the note's date first. "team" finds Team Standup.
3. **Linked.** Picking an event links it and merges its guests into the attendees, then returns to the main view. The top row now shows the event: dot, title, date and time. Under it are a **Join** button (only when the event has a meeting link) and **Open in Google Calendar** or **Open in Outlook** (only when a web link is stored, so never for Apple). The capsule keeps the note's date and attendees.
4. **Changing.** Reopening the list while linked shows **Remove calendar event** first, then the events, with a check mark on the linked one. Removing it unlinks the event and leaves the attendees as they are.

Join only opens the meeting URL. It never starts a recording, unlike Upcoming Meetings' "Join & transcribe".

Out of scope: Granola's "Create folder for this meeting" banner, renaming the note after the event, live provider search, events older than the stored window, and day-by-day browsing (see Open questions).

## Acceptance criteria

1. An editor can link any event stored locally from the capsule dropdown, in a private note or a team note. One note write sets `calendar_event_id` and the merged `participants`.
2. Merging attendees keeps everyone already on the note and appends the event's guests. Duplicates are matched by email, ignoring case and spaces. A guest the provider flags as the user (`self`) is marked self.
3. The picker opens on the note's local day. The search box matches titles and attendee names or emails across every stored event, and works offline and with an expired provider token, because it reads only the local table.
4. Each provider stores at least 3 days of history after its next full sync. Existing Google and Microsoft sync tokens are discarded once so that sync happens on first launch. Apple's helper snapshot covers the same 3 days.
5. Unlinking syncs. It never comes back on another device, for a teammate, or after a later pull.
6. Viewers (`canEditNote` false) see a linked event and can Join or Open it, but can't link, change or remove one.
7. A linked id this device can't resolve shows a quiet fallback row in the dropdown, with no Join or Open buttons.
8. Meeting detection, reminders, Upcoming and availability behave as before. They only read events near now.
9. Every new string goes through i18n, in all 11 locale files.

## Decisions

### 1. Storage window: 3 days back, stored locally for every provider (Josh)

One shared constant, `CALENDAR_LOOKBACK_DAYS = 3`, lives in a new shared ESM module, `src/helpers/calendarCacheWindow.js`. Main-process managers and the renderer both read it.

| Provider | Today | Change |
|---|---|---|
| Google | full sync `timeMin = now − 2 h − 48 h` (`googleCalendarManager.js:174-179`) | `timeMin = now − 3 d`. `timeMax` is unchanged |
| Microsoft | delta `startDateTime = now − 24 h − 2 h` (`microsoftCalendarManager.js:431-436`) | `startDateTime = now − 3 d`. End is unchanged |
| Apple | Swift `predicateForEvents(now − (2 h + 300 s), …)` (`macos-calendar-listener.swift:31,252`) | the app passes `--lookback-seconds <3 d>`. The helper uses the larger of that value and its old minimum |

Three days covers both old lookbacks, so availability, which needs at most 2 h + 48 h of padding, never loses coverage. A test pins that invariant.

Tokens: Google sync tokens and Microsoft delta links pin the window they were created with (`googleCalendarManager.js:13`, `microsoftCalendarManager.js:14-16`). A one-time migration (`user_version` 5) clears both, like the earlier resets at `database.js:893-912`, so the next sync is a full one with the new window. Apple has no tokens: every snapshot rewrites its rows.

Pruning stays as it is. A Google or Microsoft full sync deletes rows the fresh snapshot lacks, and an Apple snapshot deletes all unlinked Apple rows (`database.js:5530-5550`, `5826-5850`). Rows a live note links to are exempt from both. I checked Apple: `replaceAppleCalendarEvents` skips note-linked ids before it upserts, so a linked Apple row survives every snapshot. Between full syncs, incremental Google and Microsoft syncs never prune by age. Microsoft can therefore hold up to about 10 days, as it already drifts today. That's harmless, so no new age-based prune is added.

Because the picked event is already in `calendar_events`, linking needs no upsert. The link alone protects the row from pruning.

Data on the device: it now keeps about 3 days of other people's meeting details (names, emails, titles) instead of about 2.

### 2. Unlinking is stored as `""`, not NULL (the sync trap)

Traced end to end:

- **Push.** `buildNoteUpdatePayload` sends `calendar_event_id: note.calendar_event_id` (`cloudSyncGuards.js:57`).
- **Server.** PATCH runs `calendar_event_id = COALESCE($12, calendar_event_id)` with `data.calendar_event_id ?? null`, and the upsert does the same (`openwhispr-api` `lib/notes-service.ts`, origin/main, lines 743/771 and 549/582). A null never clears the server copy.
- **Pull.** `calendar_event_id = COALESCE(excluded.calendar_event_id, calendar_event_id)` with `cloudNote.calendar_event_id || null` (`database.js:6466,6498`). A cloud null or blank never clears a local link.

So a NULL unlink would stay local. The next pull, or any teammate's push of their still-linked copy, brings it back.

**Fix: unlink writes `""`.** The repo already uses the same convention for a summary: "A blank is sent only as a deliberate clear, as `""` (the server reads a null summary as omitted)" (`cloudSyncGuards.js`).

- The push carries `""`.
- The server's `z.string().nullish()` accepts it, and `COALESCE('', old)` stores `''`. **No API change is needed.**
- The pull maps `cloudNote.calendar_event_id ?? null`, so `''` reaches COALESCE as a value and clears the local id, while a missing or null field still keeps the local one.

Every reader treats `''` as unlinked:

- The renderer's truthiness checks.
- `getCalendarEventById('')` → null.
- The prune subqueries, which match no event id.
- Mobile's `if (!note.calendarEventId)` checks (`openwhispr-mobile/src/lib/notes/localMeetingNotes.ts:120` and others).

noteUndo's trigger already treats `''` and NULL as equal, so a pull's blank echo doesn't count as an edit.

### 3. An event already linked to another note: allow, silently

Several notes per event already exist and are handled. `getOwnNoteByCalendarEventId` picks the newest own note (`database.js:5342-5366`), and a meeting prompt or Join resumes that note. Moving the link would silently edit a note the user isn't looking at, and a warning adds UI for a rare case. Linking B leaves A linked. This matches today's behaviour when two notes come from one meeting.

### 4. Team notes and permissions

- **Who may change it.** Only an editor: `canEditNote` in `NoteEditor.tsx:331`, passed down as `canEdit`.
- **Viewers.** No selector row. They see a linked event as a static row, with Join and Open when their own calendar has the event.
- **What a teammate sees.**
  - Google: every invitee shares the same id (`database.js:5340-5343`), so an invited teammate sees the event.
  - Microsoft and Apple: ids differ per mailbox or device.
  - Mobile: it writes a JSON string as the id (`openwhispr-mobile/src/lib/calendar/meetingContext.ts:145`).

  In all of these cases the id doesn't resolve. The capsule then shows the date, and the dropdown's top row says the event isn't in this device's calendars. There's no title, no Join and no broken chip. An editor can still replace or remove the link.
- **Merged attendees are visible to the team.** Merging adds the guests to `participants`, which syncs. That's the user's own action, the same as adding attendees by hand today.

### 5. The read-only chip is replaced by the dropdown row

The capsule keeps showing the note's date and attendees whether or not an event is linked, as Granola does ("Today · 5" while Team Standup is linked). The linked event appears only in the dropdown's top row, so it isn't shown twice. (Josh, 2026-10-20.)

`PersonalNotesView` still reads the linked event with `gcalGetEvent`, which is local for every provider. It now keeps the whole row instead of only the name, because `isRegenerableNoteTitle` (`PersonalNotesView.tsx:781-785`) needs the summary.

### 6. Which events the picker lists

- **Selected calendars only.** Uses `SELECTED_CALENDAR_EVENT_FILTER`, with Apple mirrors of REST events collapsed by `dedupedEventsQuery`.
- **Excluded:** cancelled events (`status IN ('confirmed','tentative')`) and events the user declined. Declined events are filtered in JS after the query, as `getActiveEvents` does, so a declined REST row still suppresses its Apple mirror.
- **All-day events** are included and labelled "All day". Date-only values are read as local dates (`parseEventDate`).
- **Dot colour** is the calendar's colour (`google_calendars.background_color`, `microsoft_calendars.background_color`, `apple_calendars.color`) when it's a `#RRGGBB` hex. Otherwise the dot is neutral.
- **Default list:** events that overlap the note's local day (`created_at`), in start order.
- **Search:** case-insensitive substring match on the title or an attendee's name or email, across all stored rows. Up to 50 results, closest to the note's date first.

### 7. Empty and error states

All of these are inside the list view, in this order:

| State | Shown |
|---|---|
| No calendar connected (no Google, Microsoft or Apple account in the settings store) | "Connect a calendar in Settings → Integrations to link events" |
| The IPC failed | "Couldn't load calendar events" |
| A search found nothing | "No matching events" |
| The note's day is before the stored window and has no events | "Only events from the last 3 days can be linked" + "Search to find events from other days" |
| The note's day has no events | "No events on this day" + "Search to find events from other days" |

Being offline, signed out, or having an expired provider token needs no state of its own: the picker reads only local rows. Team notes while signed out follow the existing permission resolution.

### 8. Undo

Link and unlink are ordinary `db-update-note` writes. `noteUndo.js` lists both `participants` and `calendar_event_id` as guarded fields, so its trigger retires any outstanding assistant Undo for that note, which is correct: the user changed the note after the assistant did. No user-facing undo is added.

### 9. Join and Open in calendar

- **Join:** `getMeetingJoinUrl(event)` (`src/helpers/meetingJoinUrl.js:39-52`) → `window.electronAPI.openExternal(url)`. `open-external` allows http, https and mailto only.
- **Open in calendar** (a separable final task):
  - A new `calendar_events.web_link` column.
  - Google stores `htmlLink`.
  - Microsoft stores Graph's `webLink` as returned. The research notes that it may open the older Outlook on the web; manual acceptance checks this.
  - Apple has no documented per-event URL, so the button is hidden there.
  - A second token reset (`user_version` 6) backfills the column.

### 10. i18n

New keys go under `notes.eventLink.*` in all 11 `src/locales/*/translation.json` files. The untitled fallback reuses `upcoming.untitledEvent`. Brand names (Google Calendar, Outlook) stay untranslated. `test/locales/translationCoverage.test.js` enforces that every key and interpolation exists in every locale. No plurals are used, so Arabic needs no plural categories.

## Platform differences

- **Apple Calendar is macOS-only.** The new helper flag needs the helper rebuilt (`npm run compile:calendar-listener`; packaged builds compile it during `compile:native`). An old helper ignores the flag and keeps its 2-hour lookback.
- **Windows and Linux** have Google and Microsoft only. The UI is the same on every platform, and Join and Open go through the `open-external` IPC on all three.

## Assumptions

- `calendar_events` is small enough to send whole over IPC on each open: about 3 days back plus 33–38 days ahead, typically hundreds of rows.
- Granola's exact search reach is undocumented. The note's day as the default matches its suggestion of the past 24 hours.

## Resolved questions (Josh, 2026-10-20)

1. **Capsule while linked:** keep the date and attendees; the event shows only inside the dropdown.
2. **Day-by-day browsing:** no arrows; search only.
