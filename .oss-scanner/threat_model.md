# OpenWhispr threat model

This file is read by Anthropic's OSS Scanner before it audits the repository. `SECURITY.md` is the public
reporting policy; this file adds the detail a reviewer needs.

## What this project does

OpenWhispr is a dictation and meeting-notes app. This repository holds two clients:

- **Desktop** (repository root): an Electron app for macOS, Windows and Linux. It records the microphone (and
  system audio for meetings), transcribes locally (whisper.cpp, sherpa-onnx) or through cloud providers, pastes
  the text into the focused app, keeps notes and history in SQLite, and runs an AI assistant with tools and
  connectors that act on the user's accounts (Gmail send, Slack, Linear, GitHub, calendars).
- **Mobile** (`openwhispr-mobile/`): an Expo / React Native iOS app with a keyboard extension, a Live Activity,
  background uploads and on-device models. Only its TypeScript builds and tests on Linux; the Swift sources
  under `modules/` and `plugins/` are in scope for review.

The server side (the OpenWhispr API and the openwhispr.com website, including its OAuth relay routes) lives in
other repositories and is out of scope, except where a client sends it something it shouldn't.

## Who the attacker is

In scope:

- A remote party who controls content the app takes in: audio or video files, a transcript, a calendar invite
  (title, description, attendees, meeting link), a shared or synced note, an email address, a Slack, Linear or
  GitHub search result, a web search result, a provider's HTTP response, a downloaded model, a deep link.
- A web page in the user's browser that reaches the app's loopback servers (DNS rebinding, CSRF, a guessed
  OAuth `state`) or opens an `openwhispr://` link.
- Another user account on the same machine, or another app on the same phone.
- Prompt injection: text from any of the sources above that steers the assistant.

Out of scope: malware already running as the same desktop user (it can read the user's files and keychain
anyway), physical access to an unlocked device, and attacks that need the user to paste a command into a shell.

## Where untrusted input enters (desktop)

- **IPC** (`preload.js`, `src/helpers/ipcHandlers.js`): the renderer runs with context isolation. Treat the
  renderer as compromised-able (it renders notes, Markdown, transcripts and model output) and check that a
  handler doesn't give it more than it needs: arbitrary file reads or writes, `shell.openExternal` with a
  non-http(s) URL, process spawning, or secrets it shouldn't see.
- **Rendering**: notes are Markdown via Tiptap (`src/components/ui/RichTextEditor*.ts*`, `html: false`), chat
  and assistant output, release notes, calendar text. XSS in the renderer, and Markdown images or links that leak
  data to a third party, matter.
- **Loopback HTTP servers**: the CLI bridge (`src/helpers/cliBridge.js`, 127.0.0.1:8200–8219, bearer token in
  `~/.openwhispr/cli-bridge.json`; `POST /v1/transcribe` takes a file path checked by `approveAudioPath`) and
  the OAuth PKCE loopback flow (`src/helpers/oauthLoopbackFlow.js`, used by calendars, Slack, Linear).
- **Deep links**: `openwhispr://` (`main.js` `open-url`, `second-instance`, `linuxUrlSchemeHandler.js`):
  OAuth callbacks, note links, workspace invitations, upgrade links.
- **Agent tools and connectors** (`src/helpers/connectors/`, `src/services/`, `src/components/chat/`): any
  action other people see (sending an email, posting to Slack, creating a Linear or GitHub issue or comment)
  must go through `prepare` → an approval card the user confirms → `commit`. The model must never reach
  `commit`, and a card must send exactly what the user saw and edited. Query results are marked untrusted and
  capped (`queryResult.js`). A way around any of this is high or critical.
- **Credentials**: BYOK API keys and enterprise cloud credentials (`src/helpers/environment.js`,
  `userData/secure-keys/`, Electron `safeStorage`); connector logins (`connectorCredentials.js`,
  `boundLogin.js`, one encrypted file per account under `userData/connectors/`); OpenWhispr session tokens.
  Check for leaks into logs (`debugLogger.js`), renderer, URLs, crash output, other accounts on the same device,
  or the wrong OAuth client.
- **Native helpers and child processes**: `resources/*.c`, `resources/*.swift`, `native/`, and the code that
  spawns them (paste helpers, key and mic listeners, text monitor, system-audio capture, whisper.cpp,
  sherpa-onnx, llama-server, Qdrant, FFmpeg, yt-dlp). Command or argument injection, path traversal, and memory
  safety bugs in the C sources on input they parse (stdin protocol, audio buffers, window titles).
- **Files and downloads**: audio import and transcription of user-chosen or URL-sourced media, model downloads
  (`scripts/lib/download-utils.js`, `src/helpers/modelManagerBridge.js`, `whisper.js`, `parakeet.js`), temp
  files, auto-update.
- **Meeting and calendar data**: Google, Microsoft and Apple calendar sync, attendee lists fed to the assistant
  (`<meeting_attendees>` fence; check that note or invite text can't fake it).

## Where untrusted input enters (mobile)

- Deep links (`openwhispr://`) and universal links, the auth flow (`src/lib/authClient.ts`), note share tokens
  (`src/lib/notes/noteShareTokens.ts`).
- The keyboard extension (`plugins/keyboard-extension/`) and the App Group storage it shares with the app
  (`modules/app-group-storage/`): what a host app can read or trigger, and what the extension stores.
- Background uploads (`modules/background-uploader/`), BYOK provider requests (`plugins/provider-networking/`),
  StoreKit and paywall handling, secrets in the keychain versus plain storage.

## Components that matter most / least

Most: the connector approval flow, credential storage and OAuth flows, IPC handlers, the CLI bridge, deep link
handling, renderer XSS, the native C helpers, the mobile keyboard extension and App Group storage.

Less: UI layout, onboarding copy, i18n files, build scripts that only run on a maintainer's machine or in CI
(still report a supply chain issue in them).

Out of scope: `node_modules/`, downloaded third-party binaries under `resources/bin/` (whisper.cpp, sherpa-onnx,
Qdrant, llama-server, yt-dlp, FFmpeg) and vulnerabilities inside third-party dependencies themselves (report how
we call them, not the library bug), `docs/`, `examples/`, `admin/`, `agent-skills/`, `nix/` packaging.

## How to exercise it

- Desktop tests: `npm test` at the root (Node test runner; Electron is stubbed). Tests sit in `test/`, mirroring
  `src/` (`test/helpers/`, `test/stores/`, `test/components/`). Many helpers are pure modules with unit tests
  (e.g. `test/helpers/connectors/`, `test/helpers/cliBridge*.test.js`), which are the easiest place to write a
  reproducer.
- Native helpers are compiled into `resources/bin/` during the image build (`linux-key-listener`,
  `linux-fast-paste`, `linux-text-monitor`, `linux-system-audio-helper`).
- Mobile tests: `cd openwhispr-mobile && node_modules/.bin/jest --ci --runInBand <path>`.
- The full Electron app can't be launched in this image (no display, no Electron binary); prefer unit-level
  reproducers against the real module.

## How we rate severity

- **Critical**: remote code execution from content the app takes in (audio file, transcript, note, invite,
  deep link, web page); a connector action sent without the user confirming the card, or sending different
  content than the card showed; a web page or another app obtaining API keys, OAuth tokens or session tokens.
- **High**: renderer XSS from synced or shared content; reading or writing arbitrary files through IPC or the
  CLI bridge; command injection into a helper process; prompt injection that exfiltrates notes, transcripts or
  contacts to a third party (e.g. through a rendered image URL or a tool); one OpenWhispr account's data or
  connector logins reachable from another account on the same device; memory corruption in a native helper on
  attacker-controlled input.
- **Medium**: secrets or note content written to logs; a deep link that changes settings or account state
  without the user's intent; leaking data across the App Group to the keyboard extension beyond what it needs;
  denial of service that needs a remote trigger and survives a restart.
- **Low**: local denial of service, crashes on malformed local files, missing hardening with no demonstrated
  impact.

A memory safety bug without a demonstrated path from attacker-controlled input is high at most. Prompt injection
that only makes the assistant give a wrong or rude answer is not a vulnerability.

## Reports and patches

Please include a reproducer we can run (a failing `node --test` or Jest test is ideal), the affected file and
function, and a minimal patch in the style of the surrounding code. Name the platform when a finding is
platform-specific (macOS, Windows, a Linux desktop, iOS).

## Anything to leave alone

- On Linux without a keyring, `safeStorage` falls back to plaintext. This matches Electron's default and is
  documented in `SECURITY.md`.
- Same-user local access to `userData/`, `~/.openwhispr/cli-bridge.json` or the keychain.
- Development-only code paths (`npm run dev`, Vite dev server, `OPENWHISPR_LOG_LEVEL=debug` verbosity) unless
  they ship in a release build.
- Long emails copied to the clipboard by the email-draft connector when they don't fit a compose URL (intended).
- GitHub Disconnect deleting the login locally without revoking it on github.com (intended; see `CLAUDE.md`).
