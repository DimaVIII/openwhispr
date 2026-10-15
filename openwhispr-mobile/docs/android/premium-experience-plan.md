# Android Premium Experience Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Main owns implementation; parallel research may inform it. Research and implementation are already authorized, so this document adds no approval gate.

**Goal:** Deliver a coherent, premium OpenWhispr Android app with working dictation, notes, Dictionary/Snippets, Style, settings, account, referrals, processing choices and Play subscription flows, supported by visual and functional evidence.

**Architecture:** Keep the existing Expo Router hierarchy and four Android tabs. Extend the existing Android presentation layer and reuse shared stores/services; isolate native Android capture and billing adaptations behind existing boundaries. Settings have one canonical home per preference, with contextual shortcuts only where a task needs them.

**Tech Stack:** Expo 55, React Native 0.83, TypeScript, Zustand, Expo Router, Kotlin/Android foreground recording, existing Superwall and entitlement integration.

**Spec:** `/Users/joshuadavidpadoa/Desktop/Android Research/2026-10-15-android-premium-ui-goal.md`, corrected by `2026-10-15-android-ui-review-decisions.md` in the same directory; implementation evidence and model/provider context in `2026-10-15-android-refinement-research.md`.

## Global constraints

- Android research and implementation use Android platform guidance. Do not expose or invoke Apple Intelligence in Android. Evaluate Google/Samsung capabilities only against public developer APIs, supported devices and the actual foreground/background workflow; manufacturer AI is optional unless it solves a verified product need.
- Keep Home, Notes, Dictionary and Style bottom tabs and the top-right Account entry.
- OpenWhispr desktop supplies the overall visual language. Wispr supplies Home/Style layout; Style context tabs match Dictionary's Words / Snippets treatment.
- Recording begins only after explicit action. The real bubble appears in onboarding practice and outside OpenWhispr, and is hidden over ordinary app screens.
- Private processing never silently falls back to uploading audio. Local inference, analytics upload and transcript sync remain distinct choices.
- Reuse desktop word-count summary/event contracts; retained transcript count is not a lifetime word total or cloud allowance.
- Retain Parakeet; evaluate exact licensed Moonshine Small/Tiny Streaming checkpoints and the complete Qwen cleanup pipeline before recommending devices.
- Keep production deploy, merge, store release and real financial transactions outside this development authorization.
- Preserve shared iOS behavior and concurrent work. Update existing draft PR #2684 with exact evidence and acceptance gaps.

## Notes import and voice capability checkpoint — review build v10

- Notes → New now offers Import audio. The import snapshots processing choices before the paywall/file picker, pins its destination and account, and saves a regular note named after the file. Private imports started in shared spaces go to Personal with privacy set before transcript content is written. Deleted/moved destinations refuse the save and leave transcript text available to copy.
- Cancellation/unmount/account-change fences discard late picker/transcription results. Only picker-owned app-cache copies and temporary retained audio are removed; source documents are preserved. A configured remote cleanup provider is disclosed separately from local audio transcription. Delayed paywall callbacks cannot restart an import after leaving or starting another request.
- Android offers no unsupported voice enrollment/retraining or setup banner. Existing profiles remain manageable, and direct enrollment links explain the current Android limitation without mounting the recorder. Existing iOS training remains available.
- Verification: six affected suites / 128 tests plus four import-screen tests passed (132 total); TypeScript passed; scoped ESLint reported zero errors / 18 warnings. Read-only independent review found two issues (private cleanup wording and late picker cache cleanup), both repaired and reverified. This is focused review, not the final whole-feature review.
- ARM64 release build v10 succeeded (2m 8s, 1,234 tasks) and was installed on `emulator-5554`. Notes → New → Import audio was exercised. The synthetic `Android-test-import.wav` produced the exact expected two-sentence transcript in a saved note; the note remained after force-stop/cold restart. Opening the result kept capture off and displayed Start dictation. A direct voice-enrollment link visibly showed the unavailable state with no recorder.
- Evidence is external under `/Users/joshuadavidpadoa/Desktop/Android Research/premium-2026-10-15/`: `ui-review-v10.apk`, `build-ui-v10.log`, `notes-import-tests.log`, `notes-import-screen-tests.log`, `notes-import-types.log`, `notes-import-lint.log`, `import-v10.png`, `import-result-v10.png/xml`, `notes-import-cold-v10.xml`, `notes-menu-v10.xml`, `import-from-menu-v10.xml`, and `voice-live-v10.png`. One synthetic note and the source WAV remain for continuation; no user notes were removed. Generated repository verification build directories were removed after copying the APK.
- Physical-device/other-provider import acceptance, broader layout/localization coverage, and full-goal review remain outstanding. UIAutomator intermittently returned a null root/hung while the emulator display was inactive; waking it restored screenshot capture. Do not count that inspection failure as a product failure or a completed cancellation interaction.

## Review focus

- Interrupted recording, denied/revoked microphone permission, or Android Back must preserve recoverable work and stop capture when cancellation is confirmed (Task 4).
- Offline retry and account switching must not duplicate word counts or attribute another account's events (Task 3).
- Purchase cancellation/pending state, restore without access, or stale account identity must not grant access or discard existing paid access (Task 6).
- Larger fonts, long labels, small displays and an open keyboard must preserve readable content and reachable actions (Tasks 1–2, 7).
- Unsupported language, low free storage, memory pressure and failed downloads must explain alternatives without silently changing a private-processing choice (Task 5).

## Navigation and state map

All detail screens push onto their existing stack with native Back. Sheets dismiss before navigation; keyboard Back dismisses the keyboard first. Unsaved edits and active recording require an explicit discard decision. Returning from system permission settings refreshes capability state without resetting a task.

| Destination                                    | Primary content/action                                                      | Disclosure and destination                                                                        | Required states                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Home `/(tabs)/(record)`                        | Words dictated, contextual tip, recent activity; enable/use bubble          | Practice launches real-bubble field; account avatar opens Account                                 | Loading/stale metrics, empty history, unavailable permission, dictation off/ready, processing/error/retry                            |
| Notes `/(tabs)/(notes)`                        | Search/list and one New action                                              | Compact New menu: Note / Record meeting / Import audio when supported; selected note opens editor | Empty/search-empty, local/sync state, import progress/failure; opening or editing never records                                      |
| Meeting `/(tabs)/(notes)/meeting-record`       | Explicit Start, then prominent Stop and elapsed time                        | Processing choice before capture; cancellation confirmation; resulting note                       | Permission/loading, recording/interruption, finishing, recoverable failure, persisted transcript, separate speaker/formatting status |
| Dictionary `/(tabs)/(dictionary)`              | Words / Snippets shared segments; searchable list                           | Add/edit in one sheet, delete confirmation where needed                                           | Empty/filter-empty, invalid/duplicate text, saving/error, saved persistence and actual dictation application                         |
| Style `/(tabs)/(style)`                        | Context segments, selected tone row, message preview                        | Tone picker sheet; advanced prompt in existing editor                                             | Selected/saving/error; persisted active context affects real cleanup; preview clearly an example                                     |
| Account `/(account)`                           | Identity and plan summary, grouped destination rows                         | Profile/plan, Preferences, AI & processing, Privacy & data, Refer & earn, Help & about            | Guest/sign-in, authenticated, loading/access refresh, account switch, failed external link                                           |
| Account → Profile `/(account)/profile`         | Identity and account actions                                                | Existing auth/profile flows                                                                       | Signed out, pending save, error; deletion uses existing deliberate flow                                                              |
| Account → Plan `/android-pro`                  | Current entitlement and cloud allowance; upgrade/manage/restore             | Existing remotely managed Superwall placements and Play subscription management                   | Loading/unavailable product, actual localized prices, checkout/cancel/pending, restore/reconcile, existing subscriber                |
| Account → Preferences `/(account)/preferences` | Language, appearance when supported, haptics and bubble behavior            | Language sheet/route; permissions and notification system settings                                | Persisted values, denied permission, unsupported control omitted with accurate capability explanation                                |
| Account → AI & processing `/android-models`    | Cloud / On-device choice; recommendation and selected speech/cleanup models | Model detail/download, advanced per-workflow provider controls via `/(account)/ai-workflow`       | Missing/download/verify/ready/failed/delete, storage warning, language compatibility, explicit private fallback decision             |
| Account → Privacy & data `/(account)/privacy`  | Retention, sync and privacy controls                                        | Retention choice with destructive consequence confirmation                                        | Saving/error, policy constraints, retained aggregate counts unaffected by transcript deletion                                        |
| Account → Refer & earn `/(tabs)/(referral)`    | Existing referral identity/program and share action                         | Native share/copy; authentication when required                                                   | Guest, load/error/retry, copy/share feedback; no fabricated referral URL                                                             |
| Account → Help & about (new account child)     | Support, feedback, app version, terms/privacy, licenses                     | External links; `/(account)/licenses`                                                             | Missing email/browser handler recovery; store review only when real listing exists                                                   |

Subscriptions belong under Plan. Third-party/model attribution belongs under Licenses. Move history retention out of the Account landing page into Privacy; move duplicate models, language, referral and permission rows out of Home. Preferences may link to task-specific settings but must not duplicate their controls. Do not offer theme/haptics switches until their runtime behavior exists.

## Shared component and file map

- `src/android/ui.tsx`: retain `Page`, `Card`, `Row`, `Button` and existing exports; improve brand tokens, spacing, icon treatment, press/disabled/loading/accessibility states, safe areas and keyboard handling without breaking callers.
- `src/components/ui/SegmentedControl.tsx` (new): `SegmentedControl<T extends string>({ options: readonly { value: T; label: string }[], value: T, onChange: (value: T) => void, accessibilityLabel: string })`; selected semantics and wrapping/scroll behavior support both Dictionary and Style.
- `src/screens/DictionaryScreen.tsx`, `src/android/StyleScreen.tsx`: share that control; preserve dictionary/snippet stores and `androidStyleContext` / `androidStyleTones` config.
- `src/screens/AccountScreen.android.tsx`, `PreferencesScreen.android.tsx`, `PrivacyDataScreen.android.tsx`; new `HelpAboutScreen.android.tsx` and `app/(account)/help.tsx`: canonical settings grouping. Reuse `LicensesScreen.android.tsx` and `ReferralScreen.tsx`.
- `src/android/Root.tsx`, `Tabs.tsx`, `Onboarding.tsx`, `Practice.tsx`, `useBubblePipeline.ts`: navigation, real practice lifecycle and foreground bubble visibility.
- `src/screens/HomeScreen.android.tsx`; new `src/android/dictationStats.ts`: presentation and a small persistent aggregate/event adapter matching desktop `src/services/AnalyticsService.ts`; keep `useUsageStore` responsible for allowance/access.
- `src/screens/NotesListScreen.tsx`, `MeetingRecordScreen.tsx`, `src/hooks/useCloudMeeting.ts`, `src/components/notes/CloudMeetingRecording.tsx`, `modules/live-pcm-streaming`: compact creation and actual Android cloud capture. Reuse recovery/persistence helpers in `src/lib/meetingRecovery.ts` and notes stores.
- `src/android/models.ts`, `ModelsScreen.tsx`, `LocalSpeechModel.ts`, `LocalTextModel.ts`, `modules/android-dictation`: device capability, verified downloads and model adapter integration. Keep benchmark findings separate from emulator smoke evidence.
- `app/android-pro.tsx`, `src/components/superwall/*`, `src/lib/superwall.ts`, `revenuecat.ts`, `billingReconciliation.ts`, `src/data/remote/billingApi.ts`: one purchase authority, existing entitlement reconciliation and Android provider configuration.

## Ordered implementation

### Task 1: Shared presentation and settings hierarchy

- [x] Extend existing Android primitives; replace text/emoji substitutes for controls with existing icon components and accessible labels. Use branded hierarchy and consistent borders, radii and restrained accent treatment.
- [x] Add the shared segmented control, then use it in Dictionary and Style. Style exposes one selected tone row plus a picker and preview instead of a wall of buttons.
- [x] Reorganize Account into the destinations above; move retention into Privacy and legal/support rows into Help & about. Remove duplicate Home controls.
- [ ] Verify native Back, route preservation after system settings, selected semantics, long labels and font scale 1.3/2.0 at compact width. Capture Home, Style, Dictionary and Account screenshots before expanding styling.

### Task 2: Focused daily interactions

- [ ] Wire onboarding/Home practice to actual bubble activation and insertion. Preserve bubble availability outside the app and hide it on ordinary in-app screens.
- [ ] Make Notes New a compact anchored menu/sheet and reuse existing create/import handlers; keep the microphone off until Start is pressed.
- [ ] Exercise add/edit/delete/search Words and Snippets, saved tone/context changes and referral share/copy against their stores/API. Show meaningful progress and retry feedback.
- [ ] Add regression cases for practice entry/exit bubble visibility and no recording on note navigation; verify keyboard/Back behavior manually on the test device.

### Task 3: Durable word totals

- [x] Read desktop event identity, word-count definition and `/api/analytics/events/batch` / `/api/analytics/summary` contract against current API code before implementing the adapter.
- [x] Add persistent local totals and an account-scoped deduplicated event queue containing counts/metadata, never transcript text. Upload only under the existing analytics/sync/organization policy gates; merge authoritative totals without double counting pending events.
- [ ] Show words dictated separately from cloud allowance, with honest loading/offline state. Transcript retention never reduces the aggregate.
- [ ] Test multilingual counting parity, event retry/idempotency, history deletion, offline-to-online reconciliation and account switch boundaries in a focused new stats test plus existing Home tests.

### Task 4: Real Android cloud meetings

- [x] Implement Android PCM capture under the existing live-streaming module contract, including microphone permission, foreground capture lifecycle and stop/cancel cleanup. Removing an unsupported-screen branch is not the implementation.
- [x] Connect PCM to the existing cloud meeting WebSocket pipeline and durable note/recovery flow. Drain the final utterance before closing the stream or persisting completion; test delayed final server messages after Stop. Separate capture/transcript, speaker attribution and formatted-note capability states.
- [ ] Verify explicit Start → live capture → Stop → persisted transcript on Android; test cancellation, permission denial/revocation, interruption, network loss and retry without duplicate notes. Private Mode must block unsupported cloud recording with an explicit alternative.
- [ ] Run existing `RealtimeMeetingWsService`, notes meeting/privacy and recovery tests, plus native/module tests for Android buffer/stop behavior. Record real-device acceptance separately from emulator/synthetic PCM evidence.

### Task 5: Local model choice and measured recommendations

- [x] Refresh exact Moonshine Android runtime/checkpoint compatibility, integrity and licenses; retain Parakeet and Qwen baseline.
- [x] Integrate the selected supported Moonshine Small/Tiny adapters behind the existing speech service contract; filter choices by language and actual runtime support.
- [ ] Surface storage needs, download/verify progress, selected state and failure recovery. Use measured capability rules; do not equate RAM/file size with acceptable performance.
- [ ] Test incompatible language, insufficient space, corrupt/interrupted download and local failure without cloud fallback. Benchmark full speech + cleanup on physical 3–4 GB, 6 GB and 8+ GB classes when available, recording latency/accuracy/memory/thermal observations.

### Task 6: Android paywall, purchase and access

- [ ] Audit current Superwall Android keys, Play catalog and existing RevenueCat role before selecting the single purchase authority. Repair the identified default Superwall purchase-handler/manual subscription-status mismatch; add a regression covering purchase-to-status reconciliation. Keep server account access authoritative and preserve already-paid users.
- [ ] Connect `/android-pro` and upgrade gates to real remotely managed presentation, localized store products, purchase/restore, subscription management and entitlement reconciliation.
- [ ] Test missing configuration, product load failure, cancellation, pending payment, dismissal/free continuation, restore with/without entitlement, account switching and reconciliation timeout using existing Superwall/billing tests.
- [ ] Validate license-tester purchases and restore/reinstall through Play test distribution on a compatible physical device. Provider/catalog access gaps remain explicit; fake SDK events do not establish purchase acceptance.

### Task 7: Whole-flow verification and review handoff

- [ ] Run touched suites with `npx jest --runInBand <test paths>`, then `npm run typecheck`, scoped ESLint and formatting; run required repository checks and native build checks for changed modules.
- [ ] Inspect the selected emulator/device and keep it awake during active tests. Walk onboarding → real-bubble insertion; all four tabs; Account details; notes/create/record/recover; Words/Snippets; Style persistence; statistics; upgrade/access.
- [ ] Inspect compact and larger displays, font scaling, keyboard, system bars, supported themes, Android Back and accessibility labels. Compare actual screenshots to the inspected references and fix visibly weak results.
- [ ] Update draft PR #2684 and handoff with final scope, screenshot locations, reproducible interaction evidence, exact test results and remaining device/provider gaps. Delete generated verification build output; retire only owned worktrees or document why retained.

## Evidence and acceptance boundaries

Research supports decisions; it does not verify implementation. Existing short file-transcription results do not verify meetings. Emulator speed does not support physical-device recommendations. A mocked successful purchase does not verify Play checkout or server entitlement reconciliation. Complete independent implementation even when provider/device access is missing, then name the exact unavailable artifact/device/account and remaining check. Do not mark the encompassing goal complete while its agreed completion conditions remain unmet.

Current platform guidance: [Android layout basics](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-basics) (safe areas, input visibility and action reach), [Android predictive Back](https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back). Josh's Android-only correction supersedes the earlier Apple settings research direction. Figma Home `21:800` and Style `21:814` were visually inspected by the main session; this plan does not claim an independent visual inspection.

## Implementation checkpoint — 2026-10-15, review build v3

The goal remains active. This checkpoint is implementation progress, not final acceptance.

- Installed `com.gizmolabs.openwhispr.dev` on live `emulator-5554` (API 36 ARM64). Build v3 succeeded in 33 seconds, 1,234 tasks. Node 24.20.0 / JDK 17.0.20.1 / arm64-v8a. External APK and evidence: `/Users/joshuadavidpadoa/Desktop/Android Research/premium-2026-10-15/`.
- Visually inspected Home, Style selected Formal, Account (v2), and Notes native New menu / New folder sheet (v3). Screenshots contain the signed-in research account's local workspace metadata and remain external, not public PR assets. Source-level presentation fixes also cover Dictionary segments and Android folder rename/move creation. Compact screen / full keyboard / font-scale acceptance is unfinished.
- V3 contains native meeting notification Stop forwarding, JS final-drain lifecycle, Android recording Back confirmation, separate transcript/speaker capability copy, saved WAV recovery, and private-mode checks. `useCloudMeeting` + realtime tests cover startup cancellation, repeated Stop, delayed final text, error and notification-stop callbacks. Real microphone-to-cloud-to-saved-note evidence is still required.
- Billing uses one Android RevenueCat controller under remote Superwall presentation, exact product/base-plan/offer selection, owner-pinned restore, server-authoritative access, persisted pending states, foreground/customer-update retry and duplicate-purchase prevention. Shared iOS receipt identification and recording/sync are serialized. Web/workspace access is preserved and management links follow ownership. No real Play transactions have run.
- Validation: typecheck passed; scoped ESLint has zero errors (style/no-void warnings remain); formatting passed; lifecycle/billing 81 tests in 6 suites passed; shared meeting/privacy/recovery/live-activity 100 tests in 4 suites passed. Earlier targeted pipeline/insights/Home suites passed 49 tests; these need re-running against the final feature.
- The API currently exposes only one selected `entitlementSources.providerStore` (`app_store` or `play_store`). A dual-store customer whose selected source is App Store cannot obtain specific backend Play proof from this field: the app retains existing access and does not claim a Play restoration. Resolve/report this contract limitation before billing acceptance.

Next independent implementation: Notes import flow; NoteEditor navigation/keyboard recording guards; unsupported Android voice-enrollment state; native Moonshine integration and model detail/device capability UI; actual bubble/meeting/Dictionary/Snippets/referral flows; compact/font-scale visual checks; final independent review, PR update and handoff. Existing Android review worktree is retained for this unfinished work and was not created by this session.

## Implementation checkpoint — 2026-10-15, Moonshine / review build v4

Moonshine Tiny/Small English streaming adapters are implemented alongside Parakeet. The app keeps Parakeet as default, uses one ORT runtime for both engines, captures model choice before queued inference, and releases speech resources before Qwen cleanup. Language/API gates apply to selection, readiness and inference. Full verified model downloads and two real ARM64 emulator smoke runs passed (including repeat Tiny after Small). Exact model accuracy caveats, licenses, native test recipe and production hosting gap are in `moonshine-runtime-research.md`; emulator timing is not a phone recommendation.

Model rows now expand to reveal download/select/remove actions. Existing files receive checksum verification and corrupted same-size weights can be repaired. An independent read-only reviewer rechecked the language and integrity repairs. Native integration does not expose a new recording owner or any silent upload fallback.

Remaining model work: device hardware/memory/storage presentation, a complete speech-plus-Qwen measurement flow and useful recommendations, real microphone/long-recording/physical-phone acceptance, and production download hosting. Remaining broader goal work is unchanged: Notes import and editor recording guards, Android voice-enrollment capability gate, real bubble/meeting/Dictionary/Snippets/referral validation, compact/font-scale/keyboard checks, whole-feature independent review, draft PR update and final handoff.

### Android-only AI correction (2026-10-15)

Josh clarified that Android must neither expose nor invoke Apple Intelligence. This is an Android product constraint; existing iOS functionality remains in its platform path.

- Canonical Account → Models now resolves `AIModelsScreen.android.tsx`; the legacy Android route redirects there. Workflow and meeting entry points use that same route. Cold-link Back returns to the tabs when there is no navigation history.
- Removed iPhone wording from shared provider-key, Private Mode and note-formatting messages. Android readiness and inference use downloaded Qwen; token budgeting does not call AppleLLM. The fallback offers Models and never changes the Apple enable setting.
- Found and repaired an additional functional leak: automatic local meeting notes previously called the iOS structured-notes helper. Android now uses Qwen with constrained JSON output, validates the schema, and shares transcript chunking/content rules. Native context overflow triggers splitting rather than falling through to Apple or cloud. Invalid output fails explicitly. Actual Qwen meeting-quality/device acceptance remains pending; automated routing/recovery checks are not inference-quality evidence.
- Targeted regression evidence: 15 suites / 201 tests pass, including Android meeting routing, malformed output, context recovery, Apple token-count exclusion and fallback behavior; TypeScript passes. Emulator v6 visibly shows Models & processing, Moonshine/Parakeet, and no Apple controls. Final v7 rebuild succeeded and was installed; cold-start models screen was visually checked, Parakeet selection persisted, and header Back returned to Home. Evidence is models-v7.png/xml and models-back-v7.xml under the external premium capture directory. Independent repair review cleared both findings; actual Qwen structured output remains pending.

Manufacturer AI evaluation: Google ML Kit GenAI provides Gemini Nano through AICore, but inference requires the app to be the top foreground app; a foreground service is insufficient. Therefore it cannot replace the downloaded Qwen engine for cross-app bubble dictation. Treat it as a possible future optional foreground optimization after capability/download/language checks, not a requirement or an exposed unavailable toggle. Samsung's old Neural SDK is no longer provided to third-party developers; no general publicly available Galaxy AI inference SDK was verified. Some Galaxy devices support Google's APIs. Keep Qwen as the current local engine and Cloud as an explicit user choice.

Primary sources checked on 2026-10-15:

- https://developers.google.com/ml-kit/genai (device support, foreground restriction, quotas, local execution)
- https://developers.google.com/ml-kit/genai/prompt/android/get-started (public beta Prompt API and availability/download flow)
- https://developers.google.com/ml-kit/genai/rewriting/android (task and language bounds)
- https://developer.samsung.com/neural/overview.html (third-party SDK availability notice)

The native Moonshine transcript logging paths were also checked: both are guarded by `options.log_output_text`, whose default is false; this integration does not enable it.

### Note recording safety checkpoint — review build v9

- Android note editors and meeting-recording routes hide the main tab bar; main screens retain all four tabs. The editor has a normal footer with an explicit Start / Stop action instead of a floating button offset for a hidden tab bar. Android uses the window resize behavior rather than adding a second keyboard-height adjustment.
- Back/removal is guarded during startup, recording and processing. Finish waits for actual completion and flushes the note before navigation; a missing-model or quota fallback remains in the editor. Discard is explicit and waits for native capture to stop, then removes the owned temporary audio. Header actions and body tabs cannot hide active recording; stale native menu events are rejected.
- Pending permission/preparation starts are single-flight and invalidated on cancellation/unmount. Cancellation rejects with AbortError so meeting/voice callers cannot treat it as a successfully started recording. Delayed paywall callbacks require the editor still to be focused. Cancelled preparation cleans its temporary file when Expo's recorder remains accessible; forced unmount after native release leaves cleanup best-effort.
- Seven targeted suites / 153 tests pass, covering recorder permission/start cancellation, temporary-file cleanup, Finish/Discard/fallback navigation, stale menu actions and existing note/voice behavior. TypeScript passes. Scoped lint reported no errors. Read-only independent review cleared the repaired navigation findings and documented the forced-unmount cleanup limitation.
- Final v9 build succeeded and was installed on OW_Research_Pixel_9 / emulator-5554. Actual synthetic note `Android test recording safety`: opening did not start capture, explicit Start changed to Stop, hardware Back showed Finish / Discard / Cancel, Cancel preserved capture, confirmed Discard stopped and returned to Notes with the four tabs restored. Evidence: editor-v9.xml, editor-recording-v9.xml, editor-back-v9.png/xml, editor-discard-v9.xml in the external premium capture directory. This verifies capture/navigation, not speech accuracy or successful Finish transcription.
- Gboard remains in its floating hardware-toolbar configuration even when show_ime_with_hard_keyboard was temporarily enabled. The setting was restored to 0; full software-keyboard layout is still unverified. The synthetic private test note remains for continued checks. No signed-in user data was removed.

Next: Notes audio import with pinned destination/privacy/account scope, unsupported Android voice-enrollment capability state, full pipeline/device recommendation measurements, and the remaining functional/visual acceptance inventory above. Final whole-feature review, draft PR update and handoff remain outstanding.

### Notes import and voice capability checkpoint — review build v10

- Commit `23334e918` adds Notes → New → Import audio. The route captures processing mode, account and folder/space before the picker opens, saves private state before transcript content, and rechecks destination/account before saving. Private imports from team destinations go to Personal. A failed save retains the transcript for copying. Picker/cache cleanup never removes the original external file.
- Android does not offer unsupported voice enrollment or retraining; a direct link explains availability without starting a recorder. Existing profile management remains available.
- Targeted tests: 132 passing tests across seven suites, TypeScript passes, scoped lint has no errors. Independent review cleared the private-cleanup disclosure and late-picker cache cleanup repairs.
- v10 installed successfully. The owned synthetic file `Android-test-import.wav` imported into a private Personal note named `Android-test-import`; the transcript was “The quick brown fox jumps over the lazy dog. Please send the meeting notes tomorrow.” It persisted after a cold restart. Notes → New → Import audio and the Android voice-unavailable screen were checked on the emulator. Evidence: `import-v10.png/xml`, `import-result-v10.png/xml`, `notes-import-cold-v10.xml`, `notes-menu-v10.xml`, `import-from-menu-v10.xml`, `voice-live-v10.png` in the external premium capture directory. This is synthetic import evidence, not physical microphone acceptance.

### Preference reliability and Insights checkpoint — review build v11

- Style now waits for confirmed preference persistence before closing the tone picker. A failed write keeps the previous tone/context and displays the error. Concurrent taps cannot start overlapping saves. Shared rows and segmented controls expose their disabled state.
- Privacy retention applies deletion only after the preference save succeeds. All preference saves show progress and serialize writes. Starting network sync does not hold the save lock, so users can opt out while a request is pending.
- Insights opt-out denies uploads in memory before the first disk write. Failed marker/config writes cannot silently re-enable uploads; only a successfully persisted explicit opt-in clears that denial. Late acknowledgements are ignored after revocation. The effective paused state is visible in Home and Privacy.
- Home separates unavailable account totals from a confirmed zero, retains and labels cached offline totals, identifies pending dictations without adding them to authoritative account totals, and clears the previous account's display immediately on an account switch. New status/save text is present in all eleven locales; native-language editorial review remains outstanding.
- Six focused suites / 63 tests pass, covering storage failures, deferred network requests, context/tone retention, retention save failure, account switches, batches over 200 events, late responses, Home states and Android local-AI routing. TypeScript passes; scoped lint has no errors (existing inline-style/no-void/hook-dependency warnings remain). Independent read-only review cleared the two follow-up findings after repair.
- Final v11 build succeeded and installed on `emulator-5554` / `OW_Research_Pixel_9`. Style Personal/Casual was changed to Excited, survived a force-stop/cold start, and was restored to Casual. Evidence: `style-v11.png/xml`, `tone-options-v11.xml`, `style-cold-v11.xml`, `style-restored-v11.xml`.
- Dictionary add/delete/persistence was exercised through the UI: owned `AndroidReviewZephyr` was added, persisted across cold start, then deleted. Final v11 shows the original `OpenWhispr` entry preserved and no synthetic word. Evidence: `dictionary-v10.png/xml`, `words-add-v10.xml`, `words-saved-v10.xml`, `dictionary-cold-v10.xml`, `word-delete-v10.png/xml`, `dictionary-final-v11.xml`. Snippets listing was inspected; create/edit/expansion acceptance remains outstanding. The swipe action lacks a spoken Delete label; include that repair in the accessibility pass.
- Artifacts are retained outside the repository under `/Users/joshuadavidpadoa/Desktop/Android Research/premium-2026-10-15/`, including `ui-review-v11.apk`, `build-ui-v11.log`, `preferences-tests.log`, `preferences-types.log`, `preferences-lint.log`. Owned generated Android build directories were removed after copying/installing the APK. The implementation worktree remains necessary for unfinished goal work.

Current next steps supersede the earlier checkpoint lists: complete Snippets/referral and bubble/meeting acceptance, hardware/memory/storage presentation and speech-plus-Qwen measurements, compact/font-scale/full-keyboard/accessibility checks (including spoken swipe-action labels), then whole-feature independent review, draft PR #2684 update and final handoff. Physical phones, production model hosting, and provider/purchase acceptance remain separate evidence gaps. The Android-only AI constraint remains unchanged; shared iOS code is not an Android capability.

### Device check and complete local pipeline — review build v12

- Models → Check this phone displays Android's reported memory availability, storage, CPU count and thermal state. It identifies emulators explicitly. Recommendations respond to OS memory/heat pressure and measured sample latency; they never switch providers, models or privacy settings. No physical-phone minimum is inferred from model sizes or emulator timing.
- The optional test accepts an existing audio recording up to 30 seconds / 25 MB and pins the selected speech/Qwen models, language, tone, dictionary and cleanup prompt. Both models must already be verified/downloaded. The complete local decode → speech → cleanup path does not upload or write history/Insights. Results are temporary; owned cache copies are removed and the original recording is retained.
- Cancellation is scoped to the test's decode/inference work. Leaving, changing account or backgrounding cancels the test. A late native picker return waits for the app to become foreground, and a cancelled queued speech job cannot cancel another job. Independent review identified the decoder cancellation and background-picker gaps; both were repaired and re-reviewed.
- Six targeted suites / 46 tests pass, TypeScript passes, scoped ESLint has zero errors / ten warnings. ARM64 build v12 succeeded and was installed on `emulator-5554`. The synthetic 4.5-second recording completed with Parakeet v3 + Qwen 1.5B: speech 4.5 s, cleanup 9.1 s, total 13.9 s. Both outputs were exactly “The quick brown fox jumps over the lazy dog. Please send the meeting notes tomorrow.” Total includes model loading/preparation/queue time. This is one emulator sample, not a phone rating or microphone acceptance.
- Leaving and reopening cleared the result; the original `/sdcard/Download/Android-test-import.wav` remained present. Evidence: `benchmark-result-v12.png/xml`, `device-check-v12.png/xml`, `device-check-cleared-v12.xml`, `benchmark-progress-v12.xml`, `device-check-tests.log`, `device-check-types.log`, `device-check-lint.log`, `build-ui-v12.log` and `ui-review-v12.apk` in the external premium evidence directory. Generated repository build directories were removed after copying/installing the APK.
- Swipe actions now expose spoken Move/Delete labels and hide unrevealed actions from accessibility. Actual assistive-technology acceptance and translation of the new device-check copy remain outstanding.

Android capability references: [ActivityManager.MemoryInfo](https://developer.android.com/reference/android/app/ActivityManager.MemoryInfo) reports system-available memory and OS pressure, not model peak use; [ActivityManager](https://developer.android.com/reference/android/app/ActivityManager) supplies the OS low-RAM classification; [PowerManager](https://developer.android.com/reference/android/os/PowerManager) supplies API 29+ thermal status; [StatFs](https://developer.android.com/reference/android/os/StatFs) supplies application-volume available storage excluding reserved blocks.

Remaining review work: real bubble practice/insertion and meeting route evidence, Snippets/referral actions, compact/font-scale/full-keyboard/theme checks, device-check localization, whole-feature independent review, final PR update/CI and handoff. Physical devices, production model hosting and real Play/provider acceptance retain their explicit evidence gaps.

### Snippets, referral and accessibility repairs — review build v13

- Snippet lookup now uses the same Unicode case normalization as the UI, with exact-spelling preference for legacy duplicates. Accented/Greek uppercase triggers can be edited, deleted and revived; active/tombstone and rename collisions preserve the correct row. Real SQLite tests cover these cases rather than mocking away SQLite's ASCII-only `lower()` behavior.
- Dirty snippet forms require discard confirmation on dismissal. Cancelling keeps the text; a vetoed drag restores the form behind the dialog. Successful save/delete closes directly. Shared iOS behavior is retained.
- Referral network failures release the Send button and retain the address for retry. Copy failures are reported, native sharing uses the backend's actual referral URL, and Android has a Back button in all referral states. No real invitation was sent during verification.
- Swipe actions are non-interactive and excluded from the compressed accessibility tree until revealed. Dictionary rows expose a labelled, confirmed accessibility Delete action. Important evidence correction: uncompressed UIAutomator XML includes non-important views, so its hidden Delete node alone did not establish screen-reader exposure. v13 compressed XML excludes hidden actions and includes the revealed Delete with its proper label/focus state. This is hierarchy evidence, not a complete TalkBack usability audit.
- Six focused suites / 38 tests pass, TypeScript passes, scoped lint has zero errors / 22 warnings. Independent review cleared the functional repairs. v13 built successfully and installed. Through the actual UI, owned snippet `androidtestsignoff` was created, edited, protected by a discard/Cancel prompt, saved, persisted through cold restart, then deleted. Original `review sign off` remained unchanged. Native sharing opened Android's share sheet with the same backend URL displayed in the app; the sheet was dismissed without choosing a recipient.
- Evidence: `snippet-created-v13`, `snippet-discard-confirm-v13`, `snippet-edit-preserved-v13`, `snippet-updated-v13`, `snippet-cold-v13`, `snippet-deleted-v13`, `referral-v13`, `referral-share-v13` PNG/XML pairs; `snippets-accessible-v13.xml`, `snippet-revealed-a11y-v13.xml`; `snippets-referral-tests.log`, `snippets-referral-types.log`, `snippets-referral-lint.log`, `build-ui-v13.log`, `ui-review-v13.apk` under the external evidence directory. v13 generated build directories were removed before the next build.
- A 320dp display at 130%/200% text exposed a clipped selectable referral URL and cramped tab labels. Repair and final rendered verification are in progress. Style's context strip scrolls horizontally at large text, while page content scrolls vertically. The emulator's on-screen Gboard remains floating; it can be opened via the toolbar menu → Show on-screen keyboard. `show_ime_with_hard_keyboard` was restored to its original `0` after the check. These captures do not establish docked-keyboard acceptance.

Current next work: finish compact layout verification and restore emulator density/font scale; complete device-check localization, bubble/insertion and meeting evidence, then the full independent review, final PR/CI and handoff. Snippet dictation expansion remains covered by automated pipeline tests, not yet by an actual spoken trigger in the bubble.

### Compact layout verification — review build v14

- Referral links wrap fully instead of clipping inside a single-line selectable field. Android bottom navigation permits two label lines and grows with font scale, including the actual tab component's icon/padding and the bottom safe inset. Detail-screen tab hiding remains unchanged. Independent review caught the initial six-pixel content-height shortfall; the final build includes the corrected calculation.
- Final v14 built successfully and installed. At 320dp width / 200% text, the full referral URL and all four tab labels were visible; scrolling reached referral input/actions and the Style tone row. Account content wrapped. Evidence: `referral-compact-font200-v14`, `referral-actions-compact-v14`, `style-scrolled-compact-v14`, `account-compact-font200-v14` PNG/XML pairs. This covers those observed states, not every screen or locale.
- Account retained readable app colors while Android system dark mode was enabled (`system-dark-v14.png/xml`); Android currently presents the app's fixed light theme and does not offer a nonfunctional appearance switch. Emulator settings were restored to original density 420 with no override, font scale 1.0, night mode no, and hardware-keyboard IME setting 0. `home-final-v14.png/xml` shows the final foreground app. Stay-awake remains enabled for active testing.
- Final native build evidence: `build-ui-v14-final.log`, `ui-review-v14.apk`. TypeScript and formatting pass; compact-layout scoped lint has zero errors / 22 warnings. The functional change retains the six-suite / 38-test result above; the later layout-only changes were verified in the rendered app. Generated repository Android build directories were removed after APK export/install.
- A fresh billing audit found an additional implementation gap to repair next: a persisted pending Play payment can remain locked after cancellation/decline/expiry because inactive CustomerInfo does not clear it and purchase entry blocks every non-idle state. Recovery must use trustworthy status or an explicit safe retry flow, not assume missing cached entitlement proves cancellation. Real Play acceptance remains external; the client recovery fix is in scope. `docs/android/acceptance.md` and README's old informational-Pro descriptions also need reconciliation with the implemented billing flow.
