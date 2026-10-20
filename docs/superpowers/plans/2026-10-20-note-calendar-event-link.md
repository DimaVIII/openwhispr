# Link a note to a calendar event — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. The main agent implements every task itself. Reviewers are read-only and never edit the branch. Steps use checkbox (`- [ ]`) syntax for tracking.

| Field            | Value                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deep_research`  | yes, in `docs/superpowers/research/2026-10-20-note-calendar-event-link-research.md`. Its live-fetch recommendation is superseded by Josh's "store 3 days locally" decision (spec Decision 1) |
| `codex_review`   | yes                                                                                                                                                                                          |
| `plan_status`    | approved 2026-10-20 by Josh (this revision: capsule keeps the date, search only)                                                                   |
| Execution method | main agent implements; reviewers are read-only                                                                                                                                               |
| Review path      | Codex branch review, then a final `/deep-review`                                                                                                                                             |
| Spec             | `docs/superpowers/specs/2026-10-20-note-calendar-event-link-design.md`. Read it first: every decision below argues from it                                                                   |

**Goal:** from the note header's date and attendees dropdown, an editor can search their locally stored calendar events and link one to the note, which merges its guests. They can also Join the meeting, open it in Google Calendar or Outlook, or remove the link, and the removal syncs.

**Architecture:**

- Each calendar provider stores 3 days of history, set by one shared constant. A one-time token reset makes the next sync a full one.
- One local IPC returns every linkable stored event with its calendar colour. The renderer filters by the note's day or a search query.
- Linking is a single `updateNote` that writes `calendar_event_id` and the merged `participants`. Unlinking writes `calendar_event_id: ""`. The cloud keeps that tombstone (its COALESCE only skips NULL), and the pull is changed to apply it.

**Tech Stack:** Electron 41, React 19 + TypeScript, better-sqlite3, react-i18next, the Swift EventKit helper. Tests are `node --test` files under `test/` (`.ts` loaded through `tsx`, components through `test/lib/rendererTestHarness.js` and happy-dom).

## Global Constraints

- **Branch and base.** Work only in `.claude/worktrees/note-calendar-event-link`, branch `feat/note-calendar-event-link`, on base `43db446e1`. Never merge.
- **No `node_modules` in the worktree.** Symlink the main clone's (`ln -s ../../../node_modules node_modules`) and list `node_modules` in the common `.git/info/exclude`. Confirm `git status --short` never shows it.
- **Node 24.** Run tests with `nvm exec 24 …`. better-sqlite3 tests skip under another ABI, and a skip is not a pass.
- **No live provider calls.** No `listEvents` IPC, no Google `q`, no Graph `$search`, and no browsed-day cache. The picker reads `calendar_events` only.
- **One lookback constant.** `CALENDAR_LOOKBACK_DAYS = 3` in `src/helpers/calendarCacheWindow.js`. Nothing else hard-codes 3 days, the Swift helper included: it receives the value as a flag.
- **Unlink writes `""`, never NULL.** Every reader must treat `""` as unlinked.
- **Join only opens the URL**, through `window.electronAPI.openExternal`. It never calls `joinCalendarMeeting` and never starts a recording.
- **Linking, changing and unlinking need `canEditNote`.** Viewers get a static row.
- **Attendee merge:** keep existing participants first, dedupe by lowercased and trimmed email, OR the `self` flag, fill a missing `displayName`. Rooms stay, matching the Join path (`meetingDetectionEngine.js:634-637`).
- **Strings.** Every new one goes under `notes.eventLink.*` in all 11 `src/locales/*/translation.json`, with real translations. Reuse `upcoming.untitledEvent`. Don't translate Google Calendar or Outlook. Don't use plurals.
- **Icons** come only from `src/components/icons` (`Calendar`, `ChevronLeft`, `ChevronRight`, `Check`, `Unlink`, `Video`, `ExternalLink`, `Search` all exist).
- **Commits.** Conventional commits with explicit paths, each ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Before every commit:** run `npx prettier --write <touched files>`, and `npx eslint <touched files>` for TS/TSX and `test/**`. ESLint ignores `src/helpers/**` and `src/utils/**`, so Prettier, the tests and `npm run typecheck` gate those.
- **Data on the device.** About 3 days of attendee data is stored instead of about 2.

## Review Focus

1. **An unlink must stay unlinked** after a later pull, a teammate's push of their still-linked copy, or a second device. Task 2 covers it with a pull test, a payload test and a SyncService round trip.
2. **Midnight, all-day, multi-day and other-time-zone events:** "events on the note's day" and "before the stored window" must use local calendar dates. Task 4 covers it with date-only and overlap tests.
3. **A link this device can't resolve** (a teammate's Microsoft or Apple id, mobile's JSON-string ids, a deleted row) must show the fallback row: date in the capsule, no Join, no Open. Task 6 has the fallback test.
4. **A declined REST event with an Apple mirror** must not come back as the Apple copy in the picker. Task 3 has the mirror test.
5. **Big calendars:** hundreds of events, long or RTL titles. Search returns at most 50 results, and rows truncate with `dir="auto"`. Task 4 tests the cap; Task 5 tests `dir="auto"` on titles.

## File map

| File                                                                                         | Responsibility                                                              | Task       |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| `src/helpers/calendarCacheWindow.js` (create, ESM)                                           | `CALENDAR_LOOKBACK_DAYS`, `CALENDAR_LOOKBACK_MS`                            | 1          |
| `src/helpers/googleCalendarManager.js`                                                       | full-sync `timeMin`                                                         | 1, 7       |
| `src/helpers/microsoftCalendarManager.js`                                                    | `_deltaUrl` start                                                           | 1, 7       |
| `src/helpers/appleCalendarManager.js`                                                        | `_helperArgs` passes `--lookback-seconds`                                   | 1          |
| `resources/macos-calendar-listener.swift`                                                    | reads `--lookback-seconds`                                                  | 1          |
| `src/helpers/database.js`                                                                    | token resets v5/v6, pull tombstone, `getLinkableCalendarEvents`, `web_link` | 1, 2, 3, 7 |
| `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts`, `src/types/calendar.ts` | `calendar-get-linkable-events`, types                                       | 3, 7       |
| `src/utils/noteAttendees.ts`                                                                 | `mergeEventAttendees`                                                       | 4          |
| `src/utils/noteEventPicker.ts` (create)                                                      | `eventsOnDay`, `searchLinkableEvents`, `isBeforeStoredWindow`               | 4          |
| `src/utils/dateFormatting.ts`, `src/components/UpcomingMeetings.tsx`                         | shared `formatTimeRange`, `formatEventWhen`                                 | 4          |
| `src/components/notes/NoteEventPicker.tsx` (create)                                          | nested list view                                                            | 5          |
| `src/components/notes/NoteParticipants.tsx`                                                  | event row, link/unlink, Join/Open                                           | 6, 7       |
| `src/components/notes/NoteEditor.tsx`, `PersonalNotesView.tsx`                               | `linkedEvent` plumbing, chip removed                                        | 6          |
| `src/locales/*/translation.json` (11)                                                        | `notes.eventLink.*`                                                         | 5, 6, 7    |
| `CLAUDE.md`                                                                                  | calendar manager bullets, picker note                                       | 8          |

---

### Task 1: Store 3 days of history for every provider

**Files:**

- Create: `src/helpers/calendarCacheWindow.js`, `test/helpers/calendarCacheWindow.test.js`
- Modify:
  - `src/helpers/googleCalendarManager.js:5-11,170-180`
  - `src/helpers/microsoftCalendarManager.js:5,22-23,431-436`
  - `src/helpers/appleCalendarManager.js:109-125`
  - `resources/macos-calendar-listener.swift:24-31,251-253`
  - `src/helpers/database.js` (new v5 block right after the v4 block ending at `:978`; comments at `:5255-5256`, `:5823-5830`)
- Test: `test/helpers/googleCalendarManager.test.js`, `test/helpers/microsoftCalendarManager.test.js`, `test/helpers/appleCalendarManager.test.js`, `test/helpers/calendarDatabase.test.js`

**Interfaces:**

- Produces:
  - `export const CALENDAR_LOOKBACK_DAYS = 3`
  - `export const CALENDAR_LOOKBACK_MS = CALENDAR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000`

  Both are ESM, like `calendarAvailability.js`. CJS callers load them with `require()`.

- Produces: `AppleCalendarManager#_helperArgs(requestAccess: boolean): string[]`, which returns `["--lookback-seconds", String(CALENDAR_LOOKBACK_MS / 1000), ...(requestAccess ? ["--request"] : [])]`.

- [ ] **Step 1: Write the failing tests**
  - `calendarCacheWindow.test.js` › "the stored lookback never shrinks availability coverage": `CALENDAR_LOOKBACK_DAYS === 3`, and `CALENDAR_LOOKBACK_MS >= MAX_BUFFER_MINUTES * 60_000 + 48 * 3_600_000`. That sum is the old Google lookback, the larger of the two providers'.
  - `googleCalendarManager.test.js` › "_syncCalendar full sync looks back CALENDAR_LOOKBACK_DAYS". Use the stub pattern of the first test in the file and parse the first call's params.
    - `Math.abs(Date.parse(timeMin) - (Date.now() - CALENDAR_LOOKBACK_MS)) < 5_000`.
    - `timeMax` is still about `now + 33 d + 48 h`, also within 5 s.
  - `microsoftCalendarManager.test.js` › "_deltaUrl starts CALENDAR_LOOKBACK_DAYS back". Parse `manager._deltaUrl("cal-1")`.
    - `startDateTime` is about `now − CALENDAR_LOOKBACK_MS`, within 5 s.
    - `endDateTime` is about `now + 38 d`.
  - `appleCalendarManager.test.js` › "the helper is told the stored lookback":
    - `_helperArgs(false)` deep-equals `["--lookback-seconds", "259200"]`.
    - `_helperArgs(true)` deep-equals `["--lookback-seconds", "259200", "--request"]`.
  - `calendarDatabase.test.js` › "reopening a pre-v5 database clears REST sync tokens once": copy "reopening a pre-v2 database clears microsoft sync tokens once" (`:237`).
    - Seed tokens on one Google and one Microsoft calendar and set `user_version = 4`. Reopen: both tokens are null.
    - Seed again and reopen: the tokens are kept.
  - `calendarDatabase.test.js` › "events from two and three days ago never surface as active, upcoming or available":
    - Upsert a Google timed event at `now − 50 h → now − 49 h` and an all-day event for the local date 2 days ago (on a selected calendar).
    - `getActiveEvents()`, `getUpcomingEvents(1440)` and `getCalendarEventsInRange(new Date().toISOString(), <now + 1 d>, ["google"])` contain neither id.

- [ ] **Step 2: Run them and see them fail**

  Run `nvm exec 24 node --import tsx --test test/helpers/calendarCacheWindow.test.js test/helpers/googleCalendarManager.test.js test/helpers/microsoftCalendarManager.test.js test/helpers/appleCalendarManager.test.js test/helpers/calendarDatabase.test.js`.

  Expected: FAIL on the missing module, the old windows, the missing `_helperArgs` and the tokens not cleared. The near-now regression test should already PASS, because it guards existing behaviour.

- [ ] **Step 3: Implement**
  - Create `calendarCacheWindow.js`. Give it a header comment that it's shared ESM (as in `calendarAvailability.js:1-3`) and why the window is 3 days: notes can be linked to recent past events.
  - **Google.** `buildFullParams().timeMin = new Date(Date.now() - CALENDAR_LOOKBACK_MS)`. Delete `BUFFER_COVERAGE_MS` and the `MAX_BUFFER_MINUTES` import; `ALL_DAY_TIMEZONE_PADDING_MS` stays for `timeMax`.
  - **Microsoft.** `_deltaUrl` `startDateTime = now − CALENDAR_LOOKBACK_MS`. Delete `LOOKBACK_SAFETY_MS`, `BUFFER_COVERAGE_MS` and the `MAX_BUFFER_MINUTES` import. Update the window comment at `:14-16`.
  - **Apple, JS side.** Add `_helperArgs`. In `_spawnHelper`, replace `let args = requestAccess ? ["--request"] : []` with `let args = this._helperArgs(requestAccess)`; the shim still prefixes `binaryPath`.
  - **Apple, Swift side.** Read `--lookback-seconds <n>` from `CommandLine.arguments` (the value after the flag, parsed as `Double`). Use `max(value, AVAILABILITY_LOOKBACK_SECONDS)`, and fall back to `AVAILABILITY_LOOKBACK_SECONDS` when the flag is missing or invalid. Use that for `start` at `:252`.
  - **database.js.**
    - Add the v5 block: `UPDATE google_calendars SET sync_token = NULL, sync_token_expires_at = NULL`, the same for `microsoft_calendars`, then `user_version = 5`. Comment: the stored lookback widened to 3 days, and tokens pin their window.
    - Fix the comments at `:5255` ("about three days back") and in `replaceAppleCalendarEvents` (the snapshot now covers the lookback, not only current/future events).

- [ ] **Step 4: Run Step 2's command again.** Expected: PASS. On macOS, also run `npm run compile:calendar-listener`. Expected: it builds `resources/bin/macos-calendar-listener` with no Swift errors.

- [ ] **Step 5: Commit** the touched files: `feat(calendar): store three days of event history for note linking`.

### Task 2: Make unlinking sync

**Files:**

- Modify: `src/helpers/database.js:6498` (`upsertNoteFromCloud`'s `calendar_event_id` param)
- Test:
  - `test/helpers/noteCloudUpsertGuard.test.js`
  - `test/helpers/cloudSyncGuards.test.js`
  - `test/helpers/syncServiceNotes.test.js` (its `setup` and `createFakeCloud` harness; `fakeCloud.js` already coalesces only null/undefined, like the server)

**Interfaces:**

- Produces: an unlinked note row has `calendar_event_id === ""`. A pulled cloud `""` clears a local id, and a pulled `null` or missing value keeps it.

- [ ] **Step 1: Write the failing tests**
  - `noteCloudUpsertGuard.test.js` › "upsertNoteFromCloud: a cloud blank calendar_event_id clears the local link". Seed a synced note with `calendar_event_id: "cal-ev-1"`, upsert a newer cloud copy with `calendar_event_id: ""`, and assert the local value is `""`.
  - Same file › "upsertNoteFromCloud: a cloud null calendar_event_id keeps the local link". The same with `null` keeps `"cal-ev-1"`.
  - `cloudSyncGuards.test.js` › "an unlinked note pushes calendar_event_id as a blank": `buildNoteUpdatePayload({ …minimal note, calendar_event_id: "" }, null).calendar_event_id === ""`. This passes today; it pins the contract.
  - `noteCloudUpsertGuard.test.js` › "linking or unlinking an event retires an outstanding assistant Undo". This passes today and pins Decision 8.
    - Make an assistant edit with `db.updateNote(id, { title: "Assistant title" }, { undoable: true, expected: db.getNote(id) })`, as `noteCreateConcurrentEdits.test.js:94` does, and assert `db.getNoteUndos().length === 1`.
    - `db.updateNote(id, { calendar_event_id: "evt-1" })` gives `db.getNoteUndos().length === 0`.
    - Repeat with a note already linked to `"evt-1"` and the update `{ calendar_event_id: "" }`. The Undo is retired too.
  - `syncServiceNotes.test.js` › "an unlinked calendar event reaches the cloud as a blank and stays unlinked after a pull":
    1. A local note linked to `"evt-1"` is pushed, and the fake cloud row has `"evt-1"`.
    2. `api.updateNote(id, { calendar_event_id: "" })`, then push. The cloud row's `calendar_event_id` is `""`.
    3. Bump the cloud copy's title from "another device" and run the pull. Local `calendar_event_id` is still `""`, and the title updated.

- [ ] **Step 2: Run them and see them fail**

  Run `nvm exec 24 node --import tsx --test test/helpers/noteCloudUpsertGuard.test.js test/helpers/cloudSyncGuards.test.js test/helpers/syncServiceNotes.test.js`.

  Expected: the "cloud blank clears" test FAILS (the local id is kept), because `"" || null` becomes null.

- [ ] **Step 3: Implement.** Change `cloudNote.calendar_event_id || null` to `cloudNote.calendar_event_id ?? null`, and leave the COALESCE as it is. Add a one-line comment: `""` is the cloud's record of a deliberate unlink, and NULL means the API omitted the field.

- [ ] **Step 4: Run Step 2's command again.** Expected: PASS, including the existing "calendar_event_id still preserved (COALESCE)" assertion.

- [ ] **Step 5: Commit**: `fix(notes): sync calendar event unlinks as a blank`.

### Task 3: Linkable events query and IPC

**Files:**

- Modify:
  - `src/helpers/database.js` (new method beside `getCalendarEventById` at `:5150`)
  - `src/helpers/ipcHandlers.js` (beside `gcal-get-event` at `:12208`)
  - `preload.js:1347`
  - `src/types/calendar.ts`
  - `src/types/electron.ts:3239-3250`
- Test: `test/helpers/calendarDatabase.test.js`

**Interfaces:**

- Produces: `DatabaseManager#getLinkableCalendarEvents(): LinkableCalendarEvent[]`.
  - Runs `dedupedEventsQuery("status IN ('confirmed', 'tentative') AND " + SELECTED_CALENDAR_EVENT_FILTER)`.
  - Then, in JS: drops `self_response_status === "declined"` (after the query, as `getActiveEvents` does, so the declined REST row still suppresses its Apple mirror), and applies `stripDedupeColumn`.
  - Adds `calendar_color`, looked up from one `UNION ALL` over `google_calendars.background_color`, `microsoft_calendars.background_color` and `apple_calendars.color`, keyed by provider and calendar id. The value is kept only when it matches `/^#[0-9a-f]{6}$/i`, otherwise null.
  - Rows come back in start order.
- Produces: IPC `calendar-get-linkable-events` → `{ success: true, events } | { success: false, events: [] }`. In preload: `calendarGetLinkableEvents: () => ipcRenderer.invoke("calendar-get-linkable-events")`.
- Produces in `src/types/calendar.ts`: `export type LinkableCalendarEvent = CalendarEvent & { calendar_color: string | null }`.
- Produces in `src/types/electron.ts`:
  - `calendarGetLinkableEvents?: () => Promise<{ success: boolean; events: LinkableCalendarEvent[] }>`
  - `gcalGetEvent`'s `event` is widened to `CalendarEvent | null`.

- [ ] **Step 1: Write the failing tests** in `calendarDatabase.test.js`:
  - "linkable events cover selected calendars and skip cancelled and declined ones":
    - Rows: a confirmed event, a tentative one, a `status: "cancelled"` Microsoft row, a Google row with `self_response_status: "declined"`, and an event on a deselected Google calendar.
    - Only the confirmed and tentative ids come back, in start order.
  - "a declined REST event keeps its Apple mirror out of the linkable list": a declined Google row plus an Apple row with the same start, end and title. Neither id comes back.
  - "linkable events carry their calendar's colour only when it is a hex colour": a Google calendar `#1A73E8` gives `calendar_color === "#1A73E8"`; a Microsoft calendar `"auto"` gives `null`; an Apple calendar `#FF0000` gives `"#FF0000"`.
  - "linkable events include all-day rows and note-linked history": an all-day row and a 2-day-old row come back.

- [ ] **Step 2: Run them and see them fail.** Run `nvm exec 24 node --import tsx --test test/helpers/calendarDatabase.test.js`. Expected: FAIL with `getLinkableCalendarEvents is not a function`.

- [ ] **Step 3: Implement** the method, the IPC handler (try/catch, debug-log the error), the preload entry and the types.

- [ ] **Step 4: Run Step 2's command and `npm run typecheck`.** Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**: `feat(calendar): list stored events a note can link to`.

### Task 4: Pure picker helpers

**Files:**

- Create: `src/utils/noteEventPicker.ts`, `test/utils/noteEventPicker.test.js`
- Modify:
  - `src/utils/noteAttendees.ts`
  - `src/utils/dateFormatting.ts`
  - `src/components/UpcomingMeetings.tsx:37-41` (delete the local `formatTimeRange` and import the shared one)
- Test: `test/services/noteAttendees.test.js`, `test/utils/dateFormatting.test.js`

**Interfaces:**

- Consumes: `LinkableCalendarEvent` (Task 3), `CALENDAR_LOOKBACK_MS` (Task 1), and the existing `parseEventDate` and `CalendarAttendee`.
- Produces:
  - `mergeEventAttendees(current: CalendarAttendee[], incoming: CalendarAttendee[]): CalendarAttendee[]`
  - `eventsOnDay<T extends CalendarEvent>(events: T[], day: Date): T[]` — events overlapping `[local midnight of day, next local midnight)`, by `parseEventDate` start and end, in input order.
  - `searchLinkableEvents<T extends CalendarEvent>(events: T[], query: string, anchor: Date, limit = 50): T[]`
    - A trimmed, lowercased substring match on `summary` or on any attendee `displayName` or `email` (via `parseAttendees`).
    - Sorted by `|start − anchor|` ascending.
    - An empty query returns `[]`.
  - `isBeforeStoredWindow(day: Date, now = Date.now()): boolean` — true when the next local midnight after `day` is ≤ `now − CALENDAR_LOOKBACK_MS`.
  - `formatTimeRange(locale: string, startTime: string, endTime: string): string`, moved verbatim from UpcomingMeetings.
  - `formatEventWhen(event: CalendarEvent, locale: string, allDayLabel: string): string`
    - The date part is `toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })` of the parsed start.
    - Joined with `·` to `allDayLabel` when `is_all_day`, otherwise to `formatTimeRange`.

- [ ] **Step 1: Write the failing tests.** Build dates with `new Date(y, m, d, h)` and date-only strings so the tests pass in any time zone.
  - `mergeEventAttendees` tests:
    - "appends new guests after the existing ones": `[dana]` + `[eve, DANA@X.COM]` gives `[dana, eve]`, and Eve's email is lowercased.
    - "fills a missing display name and keeps the self flag": `{ email: "me@x.com", displayName: null, self: false }` + `{ email: "Me@x.com ", displayName: "Me", self: true }` gives one entry `{ email: "me@x.com", displayName: "Me", self: true }`.
    - "ignores guests without an email" (`email: null`).
    - "an event without guests changes nothing": the result deep-equals `current`.
  - `noteEventPicker.test.js`:
    - "eventsOnDay keeps overlapping timed and all-day events":
      - Day Oct 20 keeps a 10:00–13:00 event, a 23:30–00:30 event that crosses into the 21st, and an all-day `2026-10-20 → 2026-10-21` event.
      - It drops an all-day `2026-10-21 → 2026-10-22` event and an `08:00–09:00` event on Oct 19.
    - "searchLinkableEvents matches titles and guests, nearest to the note first": "team" matches "Team Standup" on two dates, sorted by distance from the anchor. "eve@x" matches by guest email. An empty query gives `[]`.
    - "searchLinkableEvents caps the results": 80 matching events give 50.
    - "isBeforeStoredWindow": with `now` = Oct 20 12:00, Oct 16 → true, and Oct 17 and Oct 20 → false (Oct 17 ends at Oct 18 00:00, which is after now − 3 d = Oct 17 12:00).
  - `dateFormatting.test.js` › "formatEventWhen labels all-day events and shows a time range otherwise": with `en-US`, an all-day `2026-10-20` gives `"Tue, Oct 20 · All day"`, and a timed event contains `" · "` plus the output of `formatTimeRange`.

- [ ] **Step 2: Run them and see them fail.** Run `nvm exec 24 node --import tsx --test test/services/noteAttendees.test.js test/utils/noteEventPicker.test.js test/utils/dateFormatting.test.js`. Expected: FAIL on the missing exports.

- [ ] **Step 3: Implement** the functions in the files named above.

- [ ] **Step 4: Run Step 2's command, plus `test/components/upcomingMeetingsTouchGrass.test.js` and `npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit**: `feat(notes): helpers for picking and merging a calendar event`.

### Task 5: The event list view (`NoteEventPicker`)

**Files:**

- Create: `src/components/notes/NoteEventPicker.tsx`, `test/components/noteEventPicker.test.js`
- Modify: all 11 `src/locales/*/translation.json`, and `test/components/fieldDirectionPolicy.test.js` (that test lists every `<input>` per component file, so add `"src/components/notes/NoteEventPicker.tsx": ["auto"]` for the search input)

**Interfaces:**

- Consumes: Task 4's helpers and `LinkableCalendarEvent`.
- Produces: `export default function NoteEventPicker(props: NoteEventPickerProps)`, with these props:

  ```ts
  interface NoteEventPickerProps {
    events: LinkableCalendarEvent[] | null; // null while loading
    loadFailed: boolean;
    calendarConnected: boolean;
    noteDay: Date;
    linkedEventId: string | null;
    onSelect: (event: LinkableCalendarEvent) => void;
    onRemove: () => void;
    onBack: () => void;
  }
  ```

  - **Layout.** A header with a `ChevronLeft` back button (`aria-label` `notes.eventLink.back`) and a search input (placeholder `notes.eventLink.searchPlaceholder`, `autoFocus`, `dir="auto"`). Escape in the input calls `preventDefault` and `stopPropagation`, then `onBack`, so the popover stays open.
  - **Remove row.** When `linkedEventId` is set, the first row is "Remove calendar event" (`Unlink` icon).
  - **Event rows.** A 6 px dot with background `calendar_color ?? neutral` (`bg-foreground/30`). The title is `summary || t("upcoming.untitledEvent")`, in a truncated `dir="auto"` span. Under it, `formatEventWhen(event, locale, t("notes.eventLink.allDay"))`. A `Check` shows when `id === linkedEventId`.
  - **Which rows.** `eventsOnDay(events, noteDay)` while the query is empty, otherwise `searchLinkableEvents(events, query, noteDay)`.
  - **Empty states,** in spec §7's order, with the keys below. `outsideWindow` gets `{ days: CALENDAR_LOOKBACK_DAYS }`.
  - **Locale** comes from `useUiLocale()`.

- i18n (English shown; translate for the other 10 locales):

  ```json
  "eventLink": {
    "selectEvent": "Select calendar event",
    "searchPlaceholder": "Search event…",
    "back": "Back",
    "removeEvent": "Remove calendar event",
    "allDay": "All day",
    "noEventsOnDay": "No events on this day",
    "searchOtherDays": "Search to find events from other days",
    "outsideWindow": "Only events from the last {{days}} days can be linked",
    "noResults": "No matching events",
    "noCalendar": "Connect a calendar in Settings → Integrations to link events",
    "loadFailed": "Couldn't load calendar events",
    "join": "Join",
    "linkedEvent": "Calendar event",
    "unavailable": "This event isn't in your calendars on this device"
  }
  ```

  The block goes under `notes`, beside `participants`.

- [ ] **Step 1: Write the failing tests.** Mount the component directly in happy-dom, following `test/components/meetingTranscriptSpeakerPicker.test.js`. Without an i18next instance `t()` returns the key, so assert on keys.
  - "opens on the note's day and filters by search": three events, two on the note's day. Two rows render. Typing "stand" leaves the Team Standup row, and its subtitle contains `·`.
  - "marks the linked event and offers removal first": with `linkedEventId` set, the first row's text is `notes.eventLink.removeEvent` and the linked row contains the check icon. Clicking remove calls `onRemove` once.
  - "selecting an event hands it back": clicking a row calls `onSelect` with that event object.
  - "shows the right empty state":
    - `calendarConnected: false` shows `noCalendar`.
    - `loadFailed` shows `loadFailed`.
    - A note day 10 days ago with no events shows `outsideWindow`.
    - Today with no events shows `noEventsOnDay`.
    - A query with no hits shows `noResults`.
  - "Escape goes back without closing": keydown Escape in the input calls `onBack`, and the event's `defaultPrevented` is true.
  - "titles keep their own direction": a title span has `dir="auto"`.

- [ ] **Step 2: Run them and see them fail.** Run `nvm exec 24 node --import tsx --test test/components/noteEventPicker.test.js`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** the component and add the keys to all 11 locales.

- [ ] **Step 4: Run Step 2's command, plus `test/locales/translationCoverage.test.js`, `test/components/fieldDirectionPolicy.test.js` and `npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit**: `feat(notes): calendar event list for the note header`.

### Task 6: Link, unlink and Join in the attendees dropdown

**Files:**

- Modify:
  - `src/components/notes/NoteParticipants.tsx`
  - `src/components/notes/NoteEditor.tsx` (`:10` remove `LinkIcon` if it's unused, `:230`/`:267` the prop, `:1032-1043` the capsule and the chip)
  - `src/components/notes/PersonalNotesView.tsx:389-398,781-785,880`
- Create: `test/components/noteParticipantsEventLink.test.js`

**Interfaces:**

- Consumes: `NoteEventPicker` (Task 5), `mergeEventAttendees` and `formatEventWhen` (Task 4), `calendarGetLinkableEvents` (Task 3), and `getMeetingJoinUrl` (`src/helpers/meetingJoinUrl.js`).
- Produces new `NoteParticipants` props:
  - `noteCreatedAt: string`
  - `linkedEventId: string | null`, passed as `note.calendar_event_id || null`
  - `linkedEvent: CalendarEvent | null`
  - `canEdit: boolean`
- Produces: `NoteEditor` replaces `calendarEventName?: string | null` with `linkedEvent?: CalendarEvent | null`. `PersonalNotesView` holds `linkedEvent` state, filled from `gcalGetEvent` with a cancelled-flag guard against a stale id. `isRegenerableNoteTitle(…, linkedEvent?.summary ?? null)`.

- [ ] **Step 1: Write the failing tests.**
  - **Setup.** Mount `NoteParticipants` in happy-dom, with the speaker-picker test's popover setup.
    - Stub `window.electronAPI` with `searchContacts`, `upsertContact`, `updateNote` and `openExternal` as call recorders, `calendarGetLinkableEvents` resolving fixtures, and `joinCalendarMeeting` as a recorder that must stay unused.
    - Set `useSettingsStore` to `gcalAccounts: [{…}]`.
    - Open the popover by clicking the trigger.
  - **Tests:**
    - "an editor links an event and its guests merge in one write":
      - With `participants: [dana]`, click `notes.eventLink.selectEvent` and then the "Team Standup" row (guests `[dana, eve]`).
      - `updateNote` was called exactly once with `(noteId, { participants: JSON.stringify([dana, eve]), calendar_event_id: "evt-standup" })`.
      - The view is back on the attendees: the attendee input is present.
    - "Join opens the meeting link and never starts a recording": with `linkedEvent` having `hangout_link: "https://meet.google.com/abc-defg-hij"`, click `notes.eventLink.join`. `openExternal` got that URL, and `joinCalendarMeeting` was never called.
    - "no Join without a meeting link": the linked event has no `hangout_link` and no `conference_data`, and the join button is absent.
    - "removing the event writes a blank link and keeps the attendees": reopen the list, click `removeEvent`. `updateNote` got exactly `(noteId, { calendar_event_id: "" })`.
    - "a viewer sees the linked event but cannot change it": with `canEdit: false`, the linked event's title is visible and Join still works, but there's no `selectEvent` row, and clicking the event row doesn't open the list.
    - "a viewer of an unlinked note sees no event row": with `canEdit: false` and `linkedEventId: null`, no `selectEvent` text renders.
    - "an unresolved link shows the fallback, not a title": with `linkedEventId: "{\"eventId\":\"e1\"}"`, `linkedEvent: null` and no matching listed event, the trigger shows the date label and the popover shows `notes.eventLink.unavailable` with no Join.
    - "the capsule keeps the date while linked": with `linkedEvent` resolved, the trigger's text still contains `dateLabel` (Granola shows "Today · 5" while linked); the event title appears only inside the popover.

- [ ] **Step 2: Run them and see them fail.** Run `nvm exec 24 node --import tsx --test test/components/noteParticipantsEventLink.test.js`. Expected: FAIL, because the rows and props don't exist.

- [ ] **Step 3: Implement.**
  - **View state.** `view: "people" | "events"` resets to `"people"` when the popover closes. On open, when `canEdit`, call `calendarGetLinkableEvents()` once and store `events` (null while pending) and `eventsFailed`.
  - **Calendar connection** comes from `useSettingsStore`: `gcalAccounts.length > 0 || mcalAccounts.length > 0 || appleCalendarConnected`.
  - **The resolved event** is `events?.find((e) => e.id === linkedEventId) ?? linkedEvent`. Its colour comes from the list row when there is one.
  - **Top section**, above the attendee input, with a `border-b`:
    - Editor, unlinked: a button row with `selectEvent`, `dateTitle` under it, and `ChevronRight`.
    - Linked and resolved: the row shows the dot, the title and `formatEventWhen`. It's a button only when `canEdit`. Below it, the Join button (`Video` icon) when `getMeetingJoinUrl(event)` returns a URL.
    - Linked but unresolved: `linkedEvent` + `unavailable`, muted. It's a button only when `canEdit`.
    - Otherwise, nothing.
  - **Events view.** While `view === "events"`, render `NoteEventPicker` in place of the whole people view. `noteDay` is `normalizeDbDate(noteCreatedAt)`.
  - **Saving.** Extend `saveParticipants(updated, extra: { calendar_event_id?: string } = {})` to spread `extra` into the same `updateNote` call.
    - `linkEvent(event)`: `merged = mergeEventAttendees(localParticipants, parseAttendees(event))`, then `setLocalParticipants(merged)`, `saveParticipants(merged, { calendar_event_id: event.id })` and `setView("people")`.
    - `unlinkEvent()`: `window.electronAPI.updateNote(noteId, { calendar_event_id: "" })`, then `setView("people")`.
  - **Capsule.** Unchanged: it keeps the `Calendar` icon, `dateLabel` and avatars whether or not an event is linked (Josh, 2026-10-20). The event is shown only inside the popover.
  - **NoteEditor.** Delete the chip block at `:1038-1043`. Pass `noteCreatedAt={note.created_at}`, `linkedEventId={note.calendar_event_id || null}`, `linkedEvent={linkedEvent ?? null}` and `canEdit={canEditNote}`.
  - **PersonalNotesView.** Replace `calendarEventName` with `linkedEvent`, and keep its `null` reset for a falsy id.

- [ ] **Step 4: Run** Step 2's command, plus `test/components/noteEventPicker.test.js`, `test/locales/translationCoverage.test.js`, `npm run typecheck` and `npx eslint src/components/notes/NoteParticipants.tsx src/components/notes/NoteEditor.tsx src/components/notes/PersonalNotesView.tsx`. Expected: PASS and clean.

- [ ] **Step 5: Commit**: `feat(notes): link a calendar event from the note header`.

### Task 7 (separable): Open in Google Calendar or Outlook

Josh can cut this task without touching Tasks 1–6.

**Files:**

- Modify:
  - `src/helpers/database.js` (an `ALTER TABLE calendar_events ADD COLUMN web_link TEXT` with the duplicate-column guard beside `:1003`; a v6 reset block after v5; `upsertCalendarEvents` column and param)
  - `src/helpers/googleCalendarManager.js` (`web_link: item.htmlLink || null`)
  - `src/helpers/microsoftCalendarManager.js` `_mapEvent` (`web_link: item.webLink || null`)
  - `src/types/calendar.ts` (`web_link: string | null`)
  - `NoteParticipants.tsx`
  - 11 locales (`notes.eventLink.openInGoogle`: "Open in Google Calendar"; `notes.eventLink.openInOutlook`: "Open in Outlook")
- Test: `googleCalendarManager.test.js`, `microsoftCalendarManager.test.js`, `calendarDatabase.test.js`, `noteParticipantsEventLink.test.js`

**Interfaces:**

- Produces: `CalendarEvent.web_link`. It's null for Apple rows, and for rows synced before the v6 reset until their next full sync.

- [ ] **Step 1: Write the failing tests.**
  - Google: "_syncCalendar stores the event's web link". An item with `htmlLink: "https://www.google.com/calendar/event?eid=abc"` is upserted with that `web_link`.
  - Microsoft: "_mapEvent keeps Outlook's web link". `webLink` maps to `web_link`.
  - Database:
    - "web_link round-trips through upsertCalendarEvents".
    - "reopening a pre-v6 database clears REST sync tokens once" (the same pattern as Task 1).
  - Component:
    - "a Google event opens in Google Calendar": the button `notes.eventLink.openInGoogle` calls `openExternal(web_link)`.
    - "an Outlook event opens in Outlook": the button is `openInOutlook`.
    - "an Apple event has no calendar button": with `provider: "apple"`, there's no open button.

- [ ] **Step 2: Run them and see them fail.** Run `nvm exec 24 node --import tsx --test test/helpers/googleCalendarManager.test.js test/helpers/microsoftCalendarManager.test.js test/helpers/calendarDatabase.test.js test/components/noteParticipantsEventLink.test.js`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** The button sits beside Join and shows only when `event.web_link` and `provider` is `google` or `microsoft`. It uses the `ExternalLink` icon and `openExternal(event.web_link)`.

- [ ] **Step 4: Run Step 2's command, plus `translationCoverage` and `npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit**: `feat(notes): open a linked event in its calendar`.

### Task 8: Docs, full validation, manual acceptance

**Files:**

- Modify `CLAUDE.md`:
  - The Google, Microsoft and Apple manager bullets: they keep 3 days of history (`calendarCacheWindow.js`), and the v5 reset.
  - The shared-table bullet: the note header links an event from local rows, and an unlink is stored as `""`.

- [ ] **Step 1: Run the full gate**: `nvm exec 24 npm test && npm run quality-check && npm run lint`. Expected: no failures. Electron-ABI skips are allowed, but none in the files this plan touches. If any of those skip, rerun them under Node 24 until they run.

- [ ] **Step 2: Manual acceptance in a dev build.** Run `npm run dev` from the worktree on macOS, with Google and Apple connected and Outlook if available, after `npm run compile:calendar-listener`.
  1. **The window widened.** The first launch logs a full Google and Microsoft sync. The picker's search finds a meeting from 2–3 days ago.
  2. **Linking.** Open a note created today and open the capsule.
     - The dropdown shows "Select calendar event" with the note's date.
     - The list shows today's events with their colour dots, and "team" filters to Team Standup.
     - Pick it: the dropdown's top row shows "Team Standup", the capsule still shows the date, the guests merged with no duplicates, and you're marked "(me)".
  3. **Join and Open.**
     - Join appears only for an event with a Meet, Zoom or Teams link. It opens the browser, and no recording starts.
     - "Open in Google Calendar" opens the event page. "Open in Outlook" opens the event, so note which Outlook web UI it lands on.
     - An Apple-only event shows no open button.
  4. **Changing and removing.** Reopening shows "Remove calendar event" first and a check on Team Standup. Remove it: the top row returns to "Select calendar event" and the attendees stay.
  5. **Unlink sync.** In a second dev profile signed into the same account, or after a pull, the unlinked note stays unlinked, including after editing its title on the second profile.
  6. **Team notes.**
     - As an editor, linking works.
     - As a viewer, there's no selector, and Join still works.
     - With a teammate's Microsoft-linked note, you see the "isn't in your calendars" row and no title.
  7. **An old note** (created more than 3 days ago) shows "Only events from the last 3 days…", and search still finds recent events.
  8. **Offline.** With Wi-Fi off, the list still loads.
  9. **No calendar connected.** The connect message shows.
  10. **Assistant Undo.** Make an assistant `update_note` edit, then link an event: the Undo toast is no longer offered.
  11. **Unchanged behaviour.** Upcoming Meetings, the meeting prompt, and reminders show only current and upcoming events.

- [ ] **Step 3: Commit** `CLAUDE.md`: `docs: note calendar event linking and the three-day calendar window`.

- [ ] **Step 4: Review.** Run the Codex branch review, then the final `/deep-review`, both read-only. The main agent fixes the findings.

---

## Deviations during implementation

- **One reset, not two.** Task 7's `web_link` backfill uses the `user_version` 5 full sync instead of a v6 reset: v5 hadn't shipped, so one reset covers both.
- **The "connect a calendar" copy** points at the Integrations sidebar item, where calendars are connected, not at "Settings → Integrations".
- **The list-opening row uses `ChevronDown`,** as Granola does, not `ChevronRight`.
- **Escape** is handled in `PopoverContent`'s `onEscapeKeyDown`, reading the view from a ref. The popover takes Escape on document capture, before the list's input, and that handler was seen running with a stale closure (Codex review).
- **Recurring Outlook occurrences** take the series master's `webLink` (added to its `$select`) (Codex review).
- **All-day mirrors** now pair by local start day and title in `dedupedEventsQuery`; before, every all-day event a Mac also syncs showed twice outside UTC (final review).
- **`isBeforeStoredWindow` became `startsBeforeStoredWindow`:** a day the stored history only partly covers also gets the outside-the-window message (final review).
- **Re-picking the linked event** goes back without merging its guests again, and the list is shown and saved only while `canEdit` (final review).
- **`updateNote`** stores an explicit NULL unlink of a linked note as `""` (final review).

## Approval

Approved by Josh on 2026-10-20. Answers to the spec's open questions: keep the date in the capsule; search only, no day arrows.
