# Linking a note to a calendar event: how to reach past events

Repo state: `openwhispr-desktop` `origin/main` @ `43db446e1` (2026-10-20). File:line refs are to that commit.

Method: I read the primary sources directly (repo via `git show`, vendor docs via WebFetch/WebSearch). The `anthropic-skills:deep-research` skill was available, but its method needs a coordinator, research subagents and note folders written into the working directory, which is the desktop repo. That breaks this task's read-only, one-file rule, so I didn't follow it.

## TL;DR

- **Locally stored history is about 1–3 days, not "today".** Google keeps roughly 2 h + 48 h back. Microsoft keeps about 26 h back at each full sync and drifts up to about 8 days between them. Apple keeps only 2 h 5 min back. Every full sync or Apple snapshot deletes older rows, except rows a note already links to. [repo]
- **Widening the stored window (option a) is cheap but can never meet "further back"**, because any fixed window ends somewhere. It also keeps more third-party attendee data on disk and makes Apple rewrite more rows every 5 minutes. [repo]
- **Server text search is uneven across providers.** Google `events.list` has `q`. Graph `calendarView` documents no `$search`, and the delta endpoint explicitly rejects `$filter`/`$search`. EventKit has no text search, only date ranges capped at 4 years. [external]
- **Granola:** since 2025-12-19 its event popover can change which event a note is attached to, and it "suggests events from the past 24 hours". I found no public statement about how far back its search reaches. [external]
- **Recommendation:** go local-first and add one per-provider primitive, `listEvents(start, end)`, fetched live. Use it for prev/next-day and date-jump browsing, and for a "search older" action that client-filters the last ~30 days. On link, upsert the chosen event so it survives pruning and works offline. Cut: widening the sync windows, Google `q`, Graph `$search`, and any persistent cache of browsed days.

## 1. Repository facts

**Sync windows.**

- **Google:** a full sync uses `timeMin = now − BUFFER_COVERAGE_MS − 48 h` and `timeMax = now + 33 d + 48 h` (`src/helpers/googleCalendarManager.js:10-15,174-179`). `BUFFER_COVERAGE_MS` = `MAX_BUFFER_MINUTES` (120) × 60 000 (`src/helpers/calendarAvailability.js:10`), so the window opens about 50 h back. The sync-token TTL is 24 h (`googleCalendarManager.js:16`), so a full sync runs at least daily. [repo]
- **Microsoft:** the delta window is `now − 24 h − 2 h` to `now + 38 d` (`microsoftCalendarManager.js:17,22-23,431-436`). The token TTL is 7 days (`:18`), or 10 minutes after a failed backfill (`:21`). [repo]
- **Apple:** the bundled Swift helper (`resources/macos-calendar-listener.swift:27-31,251-254`) builds `predicateForEvents(now − (2 h + 300 s), now + 32 d)`. It re-snapshots on `EKEventStoreChanged`, every 300 s, or on a `"sync"` line on stdin (`:278-305`). [repo]

**Pruning.**

- Google and Microsoft: a full sync calls `removeStaleCalendarEvents` (`googleCalendarManager.js:295`, `microsoftCalendarManager.js:281`). It deletes every row for that calendar that is not in the fresh snapshot and not referenced by a live note (`src/helpers/database.js:5530-5550`). [repo]
- Apple: `replaceAppleCalendarEvents` deletes all Apple rows except note-linked ones on every snapshot (`database.js:5826-5850`). [repo]
- Deselecting a calendar removes its events (`database.js:5557-5565`). [repo]
- The code itself says the table holds "about two days back to a month ahead" (`database.js:5255-5256`). [repo]

**What the tokens constrain.**

- Google forbids `timeMin`, `timeMax` and `q` alongside `syncToken`, and the repo's comment says tokens pin the window (`googleCalendarManager.js:13`). [repo] [external] https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Graph encodes every initial delta parameter, the window included, into the deltaLink (`microsoftCalendarManager.js:14-16`). [repo] [external] https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0
- So changing a window takes effect at the next full sync. Google's daily TTL covers that; Microsoft would need its stored tokens cleared, as an earlier migration did (`database.js:910-912`). [repo]

**Attendees.**

- They are stored inline in `calendar_events.attendees`, a JSON column added by migration (`database.js:1003`). Each provider maps them: Google at `googleCalendarManager.js:268-279`, Apple at `appleCalendarManager.js:335-347`. Synced attendees are also written to `contacts`/`contact_sources`, which outlive the window. [repo]
- `createNoteAttendeesLookup` reads only `organizer_email` from the linked event, via `getCalendarEventById` (`src/helpers/connectors/contactSearch.js:116-140`). [repo]

**`gcalGetEvent`.** Despite the name, it reads the local table for any provider: IPC `gcal-get-event` → `databaseManager.getCalendarEventById` (`src/helpers/ipcHandlers.js:12208-12214`, `preload.js:1347`, `database.js:5150-5157`). If an event is pruned, the note shows no name, which is why linked rows are exempt from pruning. [repo]

**What a local search IPC needs.**

- Reuse `dedupedEventsQuery` and `SELECTED_CALENDAR_EVENT_FILTER` (`database.js:196-229`). The first collapses Apple copies of Google/Microsoft events; the second respects calendar selection.
- Add a date range (the same approach as `getCalendarEventsInRange`, `database.js:5106-5140`, which parses all-day dates properly) plus a `summary`/`attendees` LIKE filter.
- Expose it as a new `calendar-search-events` handler and preload method. [repo]

**Risk from storing more history.** The detection, reminder and "upcoming" queries are bounded by now (`database.js` `getActiveEvents`/`getUpcomingEvents`, about lines 5035-5100). Contact lookup sorts by distance from now with `LIMIT 1000` (`:5270-5285`). Low functional risk, then. The real costs are data minimisation and Apple's 5-minute full-rewrite transaction growing. [repo]

**Team notes.** `calendar_event_id` syncs to the cloud (`database.js:6443-6498`), but the event row is local. A teammate sees the event name only if their own sync holds that id. Google gives every invitee the same id (`database.js:5340-5343`); Microsoft and Apple ids are per mailbox or device. [repo]

## 2. Options

**a. Widen the stored lookback (14/30/90 d).**

- Google: change `timeMin`; the next daily full sync applies it.
- Microsoft: change `_deltaUrl` and invalidate stored deltaLinks.
- Apple: add a separate lookback constant. EventKit caps a predicate at 4 years and silently truncates longer ranges. [external] https://developer.apple.com/documentation/eventkit/ekeventstore/predicateforevents(withstart:end:calendars:)
- Pros: one-line changes, fully offline, consistent search.
- Cons: still fails beyond N days. Full syncs page more data every day (Google) or week (Microsoft). Apple rewrites more rows every 5 minutes. It keeps attendee emails for N days that the product doesn't need.

**b. Live search on demand.**

- Google `events.list` with `timeMin`/`timeMax` + `singleEvents` + `q`. `q` searches summary, description, location, and attendee/organizer names and emails. [external] same events.list URL
- Graph `calendarView` needs `startDateTime`/`endDateTime`. Its page says only "some" OData parameters are supported and lists no `$search`. The `$search` concept page covers messages, people and directory objects, not events. [external] https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0 · https://learn.microsoft.com/en-us/graph/search-query-parameter
  - The documented route is to fetch a range and filter on the client. I did not verify whether `$filter=contains(subject,…)` works on calendarView, so don't rely on it.
- Apple: range fetch, then filter. That needs a new helper stdin command such as `range <start> <end>`, because the helper currently accepts only `"sync"`.
- Pros: unlimited reach, nothing stored.
- Cons: online only (except Apple), three different query shapes, and quota use per keystroke unless debounced or explicit.

**c. Hybrid (recommended shape).**

- Instant local results, plus day browsing that fetches a day live when it falls outside local coverage.
- Optional "search older", done as one ranged fetch of about 30 days with a client-side filter. That makes it the same code path for all three providers and needs no `q`/`$search`.
- Cost: one small request per day viewed. The existing `_apiGet` paths already handle auth (`microsoftCalendarManager.js:213`; `googleCalendarManager.js` `_apiGet`).

## 3. Granola

- The 2025-12-19 changelog says "you can now change which event a note is attached to" and that it "suggests events from the past 24 hours when attaching notes". [external] https://www.granola.ai/updates/whats-new-2025-12-19
- Its help center says it doesn't import past calendar events, and that "Coming up" pages through upcoming events and hides declined and non-event blocks. [external] https://docs.granola.ai/help-center/getting-started/syncing-your-calendars
- **Unknown:** whether the picker searches beyond 24 h, has a date control, or calls the provider live. None of that is documented publicly. Its default (the last 24 h) matches "the note's day".

## 4. Recommendation

1. **The picker opens on the note's day**, read from the local table. The search box filters local rows instantly across all stored days.
2. **Add prev/next-day arrows and a date jump.** If the chosen day is outside local coverage, call a new main-process `calendar-list-events(start, end)` that fans out to each connected provider's live range fetch:
   - Google: `events.list` with `singleEvents`.
   - Microsoft: `calendarView`.
   - Apple: the new helper `range` command.

   Results stay in memory and are not stored. Offline, Google and Microsoft show "Connect to see older events"; Apple still works because EventKit is local.

3. **Add a "Search older events" row** when local search runs out. It makes one 30-day ranged fetch per provider and filters on the client.
4. **On link, upsert the picked event into `calendar_events`** and merge its attendees. Note-linked rows are already exempt from pruning (`database.js:5537-5543,5833-5840`), so `gcalGetEvent`, attendee lookup and the header keep working offline.
5. **Cut:**
   - Widening the sync windows: it doesn't meet the requirement and adds stored personal data.
   - Google `q`, because it's Google-only.
   - Graph `$search`, because it isn't documented for events.
   - Any cache of browsed days.
   - Live per-keystroke search.

## 5. Scope addition: Join and Open in calendar [repo]

**Join-link extraction already exists.**

- `getMeetingJoinUrl(event)` (`src/helpers/meetingJoinUrl.js:39-52`) returns `hangout_link`, or else the first video `entryPoints` URI from `conference_data`.
- `extractMeetingUrl` (`:57+`) recognises Zoom, Meet, Teams (`/l/meetup-join`, `/meet`), teams.live, Webex and Chime links (`:3-16`).
- Each provider maps the link like this:

| Provider                  | Where `hangout_link` comes from                                                                  | Location                              |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Google                    | `hangoutLink`, else text search of location and description                                      | `googleCalendarManager.js:263`        |
| Microsoft (Outlook/Teams) | `onlineMeeting.joinUrl`, else `onlineMeetingUrl`, else text search of location and `bodyPreview` | `microsoftCalendarManager.js:349-352` |
| Apple                     | text search of url, location and note URLs, else any https `event.url`                           | `appleCalendarManager.js:325-328`     |

**Opening a link.**

- Renderer: `window.electronAPI.openExternal(url)` → IPC `open-external`, which allows only http, https and mailto (`ipcHandlers.js:4688-4699`, `preload.js:613`).
- The `openJoinUrl` wrapper is local to `UpcomingMeetings.tsx:29-35`. Its main button is "Join & transcribe" (`:176-193`), which also starts recording.
- The notification's join goes through `openExternalUrl` in `meetingDetectionEngine.js:471-473`.
- For the note header, plain `openExternal(getMeetingJoinUrl(event))` fits best. The note already exists, so there's no need for join-and-transcribe.

**"Open in calendar": neither web link is stored today.**

- Google: the API returns `htmlLink` ("An absolute link to this event in the Google Calendar Web UI"). It needs a new column, mapped in `_syncCalendar`. [external] https://developers.google.com/workspace/calendar/api/v3/reference/events
- Outlook: delta returns full properties, including `webLink`. Microsoft's docs say `webLink` opens only older Outlook on the web. The current format is `https://outlook.office365.com/calendar/item/{url-encoded id}` for work accounts, or the `outlook.live.com` equivalent for personal accounts. Store `webLink` and convert it, or build the URL from the id and account type. [external] https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0
- Apple: there is no documented per-event URL. The `ical://ekevent/…` scheme is undocumented, and `open-external` would block it anyway. Hide the button for Apple, or add a narrow IPC that opens Calendar.app.
- Events fetched live for a past day also need `htmlLink`/`webLink` captured before they're upserted on link.
