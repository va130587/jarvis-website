# NOVA Test Report

Run: `npm test` on Node 22.22, Playwright 1.56 + Chromium, Linux sandbox. Result after the hardening and redesign (Phases 0 to 6) on top of Milestones 1 to 8: **451 tests: 450 passed, 0 failed, 1 skipped** (about 9 minutes), after the five newest features were added. Three runs in a row, plus CI on GitHub Actions. Only tests that were executed are listed.

| Area | File | Tests | What it proves |
|---|---|---|---|
| NOVA server API | `tests/server-api.test.js` | 24 pass (Phase 1; three updated for the agent) | anonymous access refused; private files never served; strict CSP and headers; dev login allow-list and loopback-only rule; CSRF and Origin checks; idle and absolute session expiry (fake clock), revoke, logout, allow-list removal; **cross-user isolation** for memories, chats, activity, export; Memory Vault CRUD with source and timestamps; secrets refused, sensitive confirmation; "remember" only proposes; "who am I" uses the account; personalisation off; **persistence across server restart** (file database); relevant-only retrieval (max 5); Claude adapter request shape (no tools, cached stable prompt) and usage/cost recording **with a stand-in client**; model failure and spending limit; honest "no model" reply; prompt-injection handling; input validation (bad JSON, type, size, 413); rate limiting; export and deletion; audit redaction; **Google sign-in against a stand-in Google** (PKCE, state, nonce, audience, expiry, allow-list, single-use state) |
| Local model (Ollama stand-in) | `tests/server-ollama.test.js` | 8 pass | status/health and setup steps; request shape (local, temperature 0, no streaming, strict tools, date + open tasks + memories as data); tool-call parsing (object / JSON-string / JSON-as-text), malformed arguments refused and corrected; clarifying questions; badge, ledger (cost 0, spending cap never blocks a local model); timeout, offline, cancel (not blamed on Ollama); a fooled model cannot skip approval; NLU eval harness (scoring rules, keyword baseline 23%, oracle stand-in 100% = plumbing check only) |
| Local model in the browser | `tests/nova-local-model-e2e.test.js` | 2 pass | normal sentence -> approved task, badge, clarify, Connected Apps status and setup checklist when Ollama is missing |
| ProofLoop | `tests/server-proofloop.test.js` | 12 pass | exhaustive 2 x 11 x 11 transition table; evidence rules; verification checks; sentence -> commitment -> Awaiting Confirmation (not verified) -> your confirmation (self-reported); reject / cancel / expiry / undo / tool failure / failed verification; owed-to-me and promised; manual API with refusals and validation; isolation; receipts (honest claims, escaped HTML); demo scenarios, reset and remove; browser/server phrase parity; hostile text in a commitment |
| ProofLoop in the browser | `tests/nova-proofloop-e2e.test.js` | 7 pass | Mission Control, demo, filters, lanes, tiles; chat -> tracked commitment; refusal to verify without proof; evidence + completion; receipt download; voice path; manual add and cancel-with-reason; layout at 3 widths; axe; keyboard |
| Agent layer | `tests/server-agent.test.js` | 14 pass | schema validator; free planner and Dubai dates; browser/server intent parity; registry completeness; read tools run alone, changes wait for approval with a full preview and change nothing until approved; stranger/double/expired/edited approvals; risk levels with auto-approve (destructive and external still ask); verification, undo (only reversible, only once); failures reported (errors, invalid input, unverifiable results, secret redaction); no automatic retry of changes, tool timeout, step limit; cancellation incl. aborting an in-flight model call; model tool-calling loop with stand-in Claude (results returned as untrusted data, usage and cost per call); **prompt injection through a hostile task title** cannot delete anything; account isolation and deletion |
| Agent in the browser | `tests/nova-agent-e2e.test.js` | 10 pass | Future Preview card, Approve/Reject/Edit/Cancel, verified result text, Undo, orb states (executing, completed), irreversible deletion wording, auto-approve switch, Dashboard approvals panel, Security tools table, voice request gets an approval, layout at 3 widths, axe, keyboard-only approve |
| NOVA in the browser | `tests/nova-e2e.test.js` | 22 pass | sign-in gate under the strict CSP with **zero violations**; 13 pages (live vs Soon/Upcoming); orb states from real events and reduced motion; chat flow with approve/reject; Memory Vault UI incl. new browser (restart) and a second user; identity edits and personalisation; usage and security pages, real file download, session-ended handling; voice request reaching NOVA; layout at 1440/768/390 px (no overlap, no sideways scroll); keyboard-only chat; axe-core on login and 8 pages (no serious or critical issues) |
| Voice helpers | `tests/speech.test.js` | 7 pass | voice ranking (Andrew > other natural > rest, never another language), honest voice report, spoken-approval parser (bare "yes", "approve and delete everything", mishearings do not approve), error explanations, provider support check |
| Voice in the browser (mock speech engine) | `tests/nova-voice-e2e.test.js` | 16 pass (run 3 times, stable) | push to talk, editable live transcript, nothing sent until Send, spoken reply; slow chunked speech and repeats; noise (low confidence flagged); wrong words corrected; silence; permission denied; network and offline; no recogniser / no synthesis; Arabic language setting; Andrew voice picked and marked, Test voice, honest note; hold-to-talk and Space; spoken approve for low-risk, bare yes ignored, delete/forget refused, reject allowed, setting off; layout and axe at 3 widths |
| Spoken approval on the server | `tests/server-agent.test.js` (1 added, now 15) | pass | `via: voice` allowed for write+undoable, 403 `voice_not_allowed` for destructive, edits by voice refused, invalid channel 400, audited |
| Daily use on the server | `tests/server-daily.test.js` | 16 pass | Dubai clock and weekdays; scheduler with a **fake clock**: runs once at the time, repeated + concurrent ticks and a second scheduler instance never duplicate, retries with 1/5-minute back-off then success, 3 failures -> failed + one notice, server off for 3 days -> one merged run, crashed runs resumed, disabled jobs skipped; schedules API validation and isolation; briefing content, focus rules, quiet day, history; "brief me" / "check my email" without approval; notifications (dedupe, read, read-all, isolation); **ntfy against a stand-in** (headers, ASCII title, click link, failures recorded, topic never exposed); classifier (critical job deadline, phishing, mailing lists, promises, questions, hostile text); demo inbox, drafts never sent (403 + audit), phishing guard, ProofLoop tracking, isolation; **Gmail against a stand-in Google + Gmail** (needs NOVA_SECRET_KEY, read-only scope + PKCE, denied / expired / bad code / signed out / another user's state / missing scope refused, single-use state, tokens encrypted and never in API or export, metadata-only fetch, entity decoding, no refetch, refresh, job notifies once, revoked -> needs reconnect, disconnect revokes and deletes); token sealing; deletion of all new tables |
| Daily use in the browser | `tests/nova-daily-e2e.test.js` | 7 pass (run 3 times, stable) | Daily Briefing page and dashboard strip, read aloud, saved copies; Smart Email demo inbox, filters, reasons, draft edit/save, send refused, phishing guard, tracking; Automation Centre switch/time/days/run now/history; bell, Escape, open from a notification, read all, browser pop-up; voice "brief me" / "any important emails"; Connected Apps rows; Gmail callback message; layout and axe at 1440/768/390 |
| Delivery | `tests/server-ops.test.js` | 5 pass | `.env` building and validation; setup server (loopback only, headers, code, cross-site refusal, write once, mode 600); **`npm start` end to end in a child process** (setup -> NOVA on the same port -> owner can sign in -> next start skips setup); demo seeding (once, all labelled) and the demo script; backup / restore (snapshot while open, manifest, pruning, safety copy, refusals) |
| ACCEPTANCE | `tests/acceptance-e2e.test.js` | 2 pass (run twice) | the setup page in a browser (wrong code, success, .env content, axe, phone width) and **NOVA_DEMO_GUIDE.md followed step by step** on the demo data: briefing focus and sections, read aloud, "brief me", Future Preview + verified result + Undo, destructive deletion not undoable, ProofLoop evidence -> Verified -> Completed -> receipt text, owed-to-me by sentence, Smart Email reasons / draft / send refused / phishing / tracking / voice, Automation run now, bell, Security tools and download, Usage |
| Knowledge, search, install (server) | `tests/server-kb.test.js` | 6 pass | passage splitting; add / ask / cited answer / "found nothing" / stemming / search-syntax injection / open / delete with index clean-up / size limit; isolation, samples, hostile document text shown not obeyed; chat phrases; global search across six kinds with literal wildcards; manifest, icons, service worker rules and offline shell completeness |
| Knowledge, search, install (browser) | `tests/nova-plus-e2e.test.js` | 6 pass (run twice) | add by typing and by file, highlighted sources, honest not-found, open, delete, samples, voice; Ctrl+K palette with keyboard, pages, "> ask NOVA", Escape and outside click; service worker registers and NOVA opens offline; layout and axe at 3 widths |
| Productivity (server) | `tests/server-productivity.test.js` | 6 pass | estimates; plan order, reasons, lunch, breaks, no overlaps, nothing changed; plan from now / tomorrow after hours / empty day / saved / estimate validation and isolation; focus one-at-a-time, stop, finish, auto-close, totals, isolation; insights numbers, on-time rate, focus trend, reliability, overdue, sentences, chat; deletion |
| Productivity (browser) | `tests/nova-focus-e2e.test.js` | 6 pass | planner timeline, hours change re-plans, set an estimate, save, focus on a block (ring, orb, top-bar chip), stop; timer end tells you by toast, voice and pop-up and records completion, marking done goes through approval; insights tiles, charts with hover and keyboard tooltip, table view, read aloud, voice phrases; layout and axe at 3 widths |
| Life tracker (server) | `tests/server-life.test.js` | 5 pass | time phrases and refusals; money and categories; reminders by sentence with approval, delivered once by the scheduler (concurrent ticks), weekday repeats Friday to Monday, late notice, cancel, snooze, isolation; habits streaks with an open today, weekday habits across weekends, 6-day window, Monday-first grid, unknown habit help, archive; money by sentence and form, summary vs last month, budget alerts once at 80% and 100%, delete, isolation, deletion |
| Life tracker (browser) | `tests/nova-life-e2e.test.js` | 6 pass | capture bar preview / approve / reject / question; reminder form, bad time message, cancel; habit add, check in, streak, heatmap, uncheck; expense with automatic category, budget, delete; voice phrase; a due reminder reaches the bell and a browser pop-up; layout and axe at 3 widths |
| Smoke walk | `tests/smoke-walk-e2e.test.js` | 6 pass | all 17 pages after their main interaction (bell, refresh briefing, chat, test voice, open a message, task Done preview + Reject, plan, life question, ProofLoop dialog, chart tooltip, KB answer, palette...) at 390/768/1024/1440 px in Deep Space and 390/1440 px in Daylight: layout check, console errors, failed requests, axe WCAG 2.1 AA serious/critical |
| Error states | `tests/error-states-e2e.test.js` | 9 pass | 500 then 429 (with Retry-After) then Try again recovers, on Dashboard, Smart Email, Knowledge Base, Life Tracker, Automation; offline: pages say "No connection", Chat keeps the typed message, everything reloads on `online`; 401 shows "Your session ended" and signing in again works; slow server (3 s): loading state, then the page, one request only; Chat 500 keeps the message |
| Stress | `tests/stress-e2e.test.js` | 2 pass | 200 tasks (Arabic, emoji, long titles), 200 e-mails, 100 documents, 100 notifications at 390 and 1440 px: each page shown within 2 s, layout clean, Arabic keeps right-to-left direction, bell shows the newest 40, palette search, no console errors |
| Races | `tests/race-e2e.test.js` | 5 pass | double-clicked Approve runs once; two approvals at the same moment give one execution; 40 page switches 15 ms apart end on the right page with no stale content; a second focus session is refused and the timer chip stays single; a background redraw keeps keyboard focus on a button without an id |
| Themes | `tests/theme-e2e.test.js` | 1 pass | Deep Space by default; Daylight by keyboard from Security and Settings; tokens change; theme-color meta; remembered after reload; back to Deep Space |
| Signature look | `tests/signature-e2e.test.js` | 4 pass | five sidebar groups and the phone bar; one greeting on the dashboard and the day's headline in the hero; count-ups end on the real number; skeleton loading with words kept; page change within 250 ms; orb colour transition; ambient layer paused when hidden and still with reduced motion (tokens 0 ms) |
| Performance | `tests/perf-e2e.test.js` | 2 pass | at 390 and 1440 px with 200 tasks: first contentful paint under 1 s (measured 160 to 270 ms), cumulative layout shift under 0.1 (measured 0.000), no long task over 100 ms while opening 8 pages (none), frame cost median under 8 ms and 95th percentile under 16.7 ms (about 2.5 and 8 ms), measured with the frame-rate cap off |
| Feature matrix | `tests/feature-matrix.test.js` | 1 pass | every page, API route (93), phrase and scheduled job is exercised by at least one test file (`FEATURE_MATRIX.md`) |
| Promise Orbit | `tests/server-orbit.test.js`, `tests/orbit-e2e.test.js` | 4 + 13 pass | states, order and wording from known rows; a task that backs a commitment shown once; 12 cap with "+188 more"; Dubai midnight; privacy; read-only; dots match the API; overdue = red + "!" + words; Tab/Enter opens an item, Escape returns focus; empty state; motion pauses (hover, hidden tab, reduced motion); layout and axe at 4 widths in both themes |
| Day Replay | `tests/server-replay.test.js`, `tests/replay-e2e.test.js` | 3 + 11 pass | every source in time order with plain titles and internal steps left out; Dubai day boundary; bad and future days refused; 500 cap says so; privacy; read-only; slider by keyboard and mouse, readout and aria-valuetext; day buttons; 240 events; no request that changes anything; layout and axe |
| Life Radar | `tests/server-radar.test.js`, `tests/radar-e2e.test.js` | 3 + 10 pass | each of the five measures from a fixed week with known answers; null for no data; week boundary; privacy; chart outlines told apart without colour, exact numbers on hover and focus, table, rules text, "not enough data yet"; layout and axe |
| Receipts and QR | `tests/qr.test.js`, `tests/server-verify.test.js`, `tests/verify-e2e.test.js` | 3 + 7 + 12 pass | encoder decoded by jsQR for versions 1 to 10, Arabic, emoji, 60 random strings, and as the SVG in a receipt; same fingerprint for the same receipt; any changed character fails; other-NOVA receipt; hostile input never echoed; 413/415/400; rate limit; no private data in answers; check page under the strict CSP; layout and axe in both themes |
| What happens if | `tests/server-effects.test.js`, `tests/effects-e2e.test.js` | 8 + 10 pass | each tool's effects from real rows; empty case; read tools have no preview; looking changes nothing; privacy; failing lookup says null; the card in the browser at 4 widths in both themes |
| Classic tools (unchanged) | earlier files | 144 pass, 1 skipped | calendar, .ics, collector, matching, Jobs for you, voice commands, Smart mode (mocked), layout, axe |

## Defects found and fixed during the hardening and redesign (Phases 0 to 6)

- The demo inbox had fixed dates and weekday words, so counts and tests changed with the calendar (failed after midnight Dubai time). Dates are now relative to today.
- A page whose first load failed could stay on "Loading…"; a dashboard with one failed part lost its error after Try again.
- Right after approving in Chat, ProofLoop could show the old state (data fetched in the last 2 s was reused). Any change now makes all data stale, an older answer never replaces a newer one, and opening a page always refetches.
- A background redraw dropped keyboard focus from buttons without an id (an intermittent failure of the keyboard-only test).
- The NOVA task list stopped at 100 tasks.
- Google Fonts loaded at runtime (console CSP errors and an outside request); fonts are now self-hosted.
- Knowledge Base overflowed at 1024 px; the floating orb covered the end of pages; Arabic lost its direction inside mixed lists.
- **Smart mode could start downloading its model while the consent question was still open** if switched on within 600 ms of the page opening. Fixed, with a regression test that fails without the fix.
- The top bar's clock went off-screen at 768 px on some classic pages (CI failure on Phase 1).
- The first load shifted the layout (0.398) when NOVA replaced the static sidebar and top bar; now 0.000.
- Phase 4 centring made the voice button move when the panel beside it grew (CI failure on Phase 4); content now starts at the top.

## Defects found and fixed while adding the five newest features

- Day Replay kept one cache entry for all days, so going back to a day fetched less than two seconds earlier left the page on "Loading…". One entry per day now.
- The planner test only passed outside working hours (it plans from the real "now"); its server and browser clocks now start at 08:00 Dubai.
- The suite sets `BASE_URL` for its browser tests, which silently changed the receipts' QR content in a server test; that test now pins it.
- A backup test hard-coded database version 7; it now compares the manifest with the database's own version.

## Not tested in the newest features (needs your devices)

- **Scanning the receipt QR with a real phone camera.** The code is decoded by an independent reader in the tests, but camera angle, print size and screen glare need a person. Check: open a receipt's printable version (ProofLoop → a commitment → the HTML receipt), scan the QR with your phone camera; with `BASE_URL` set it should open the check page and say "Matches"; without it, it shows the 64-character fingerprint to paste.
- **Motion of the Promise Orbit on a real device.** Measured only in headless Chromium; look at the dashboard on your phone and laptop for smoothness.

## Not tested in the hardening and redesign (needs your devices)

- **Frame rate and first paint on your own hardware.** Measured in headless Chromium only. Check: open NOVA in Chrome, DevTools > Lighthouse > Performance (expect First Contentful Paint under 1 s and CLS 0), then DevTools > Performance > record while switching pages (no red long tasks; frames under 16.7 ms).
- **Installed app on a phone.** Check: install NOVA (Chrome/Edge: install icon; iPhone Safari: Share > Add to Home Screen), choose Daylight, close and reopen: no dark flash; turn on airplane mode, open a page: "No connection"; turn it off: the page reloads by itself.
- **Real microphone, real Gmail, real Google sign-in, real Ollama, real ntfy push** are unchanged from earlier milestones and still need the steps listed below.

## Not tested (and why)

- **Real Google sign-in:** needs your Client ID and a person at the consent screen. Tested only against a stand-in.
- **Real Claude calls:** no API key (and nothing paid is being used). Tested only with an injected stand-in client.
- **Real microphone speech recognition**, accuracy, background noise, different speeds: no microphone in the sandbox. Voice-to-NOVA is tested through the typed command path only.
- **Real Gmail/Outlook, job boards, ntfy:** the sandbox blocks these hosts and they are not built (Gmail) or were fixture-tested earlier.
- **Load, penetration and long-running tests:** not performed.
- The 1 skipped test is the NOVA live Google sign-in check (needs a Client ID).

## Defects found and fixed while testing (Phase 1)

1. Session endpoint required sign-in (it must be public) – fixed.
2. A screen re-fetched and re-rendered itself endlessly (it polled itself); redraws now happen only when data changed, ignoring volatile fields – fixed.
3. CSP blocked the Job finder's board requests – the allowed list now includes the job boards.
4. Oversized request bodies reset the connection instead of returning 413 – fixed.
5. Display name defaulted to a lowercase e-mail prefix – now capitalised.
6. Tab focus was lost after sending a chat message – focus returns to the message box.
7. Sign-in screen failed an accessibility rule at first run; top bar overflowed by a few pixels at 390 px – fixed.
8. Test helper evaluated mock scripts with `eval`, which strict CSP forbids – mocks are now plain init scripts.

## Defects found and fixed while testing (Phase 2)

1. A test-time clock jump expired the session (idle timeout) before an approval-expiry check: the test now keeps the session alive.
2. The Claude request object was captured by reference, so later messages appeared in an earlier request in the test: the stand-in now copies it.
3. Voice phrases such as "add a task..." were swallowed by the browser-only Classic tools instead of NOVA: one shared `intents.js` now decides, and a parity test keeps browser and server in agreement.
4. axe-core's own stylesheet fetches were refused by the strict CSP and showed up as console errors: filtered in that test only (noise from the checker, not the app).

## Not tested (Phase 2)

Real Claude tool calling (paid API, not used); external tools (none exist yet, a stand-in proves they always ask); concurrent approvals from two processes (single server process only).

## Defects found and fixed while testing (Milestones 1 and 2)

1. The new ProofLoop lanes listed an overdue "Task Prepared" item twice (attention and in progress): each commitment now sits in exactly one lane.
2. A "sentence -> approve -> done" path for a model-planned run showed only the model's own words; NOVA now always appends its own verification ("Checked by NOVA: Read back from the database...").
3. The commitment dialog used a nested form (invalid HTML, so the button vanished): replaced by a plain control with a button action.
4. Two older tests were timing-sensitive (a calendar toggle and the job-source list re-drawing once at start-up): they now wait for the state they check. No application behaviour changed.

## Notes from Milestone 3

The older reminder timer can post "Reminder: ..." into the voice log at any moment, which made two voice tests flaky; tests now ignore those lines. A bare `webkitSpeechRecognition` exists in headless Chromium, so the "no recogniser" test removes it explicitly.

## Defects found and fixed while testing (Milestone 4)

1. The scheduler skipped every tick after the first quiet one: when a pass had nothing to wait for, its "busy" flag was cleared before it was set. Found by the fake-clock tests; fixed by clearing the flag after the whole pass.
2. The Daily Briefing and Automation pages redrew forever because each fetch carries a fresh timestamp; those fields are now ignored when deciding whether to redraw.
3. Clicking a notification did nothing: the panel stopped the click from reaching NOVA's action handler.
4. A decorative layer of the briefing banner extended off-screen at 768 px (layout check), and the run-history table could not be scrolled by keyboard at 390 px (axe). Both fixed.
5. "Read it to me" claimed to be reading aloud when spoken replies were switched off; it now shows the text instead and says why.

## Defects found and fixed while testing (Milestone 8)

1. The habit heatmap's first column started on a Tuesday instead of a Monday (off by one day); found by a test that checks the grid's first weekday.
2. "Remind me to submit the report tomorrow" kept "tomorrow" in the task title instead of setting the due date.
3. At three columns the Life Tracker forms were cramped (placeholders cut off); the page now uses two columns with wrapping form fields.

## Defects found and fixed while testing (Milestone 7)

00. GitHub run 4 failed because the older reminder pop-up replaced the "Evidence added" message a moment after it appeared; a person could miss it the same way. Messages now stack (up to three) and each disappears on its own timer.

0. The orb could drop from "Focusing" to "Idle" when another event (such as voice) ended during a session; idle now means focusing while a session runs. The Focus page also redraws when a session is started or stopped in another tab or device.

1. A global SVG style drew outlines on the charts' invisible hover areas and stroked the axis text; chart parts now set their own stroke.
2. The empty reliability ring showed a stray dot (a zero-length rounded line); it is hidden when there is no score.
3. The focus timer chip's accessible name did not contain its visible time (axe); it now reads "Focus, time left 12:34".
4. With a focus session running the top bar overflowed at 768 px; the "Voice ready" chip gives way to the timer on narrower screens.

## Defects found and fixed while testing (Milestone 6)

1. The command palette stayed visible after Escape: its CSS display rule overrode the `hidden` attribute.
2. Escape only closed the palette while its input had focus; it now works from anywhere while the palette is open.
3. The new Search button pushed the clock out of the top bar at 768 px; its label now collapses to an icon below 1100 px.
4. The Security tools table could not be scrolled by keyboard at 390 px (axe); tables are now focusable regions.

## Not tested (Milestone 4)

Real Gmail (needs your Google OAuth client with the Gmail API and NOVA_SECRET_KEY), a real phone receiving ntfy pushes, the scheduler running for days in real time, and classification accuracy on your own mail. How to verify each: README "Daily use" and NOVA_FEATURE_STATUS.md.

## Not tested (Milestone 3)

Real microphone accuracy, whether your browser offers "Andrew", Arabic recognition quality: run `NOVA_VOICE_TEST_SCRIPT.md` (10 minutes).

## Not tested (Milestones 1 and 2)

Real Ollama model accuracy (run `node scripts/eval-nlu.js --provider ollama --min 0.8` on your machine; the keyword-only baseline is 23%); real Claude; ProofLoop with real Gmail/calendar evidence (those connectors do not exist yet); automatic follow-ups (the scheduler is Milestone 4).
