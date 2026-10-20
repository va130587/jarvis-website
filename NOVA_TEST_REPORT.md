# NOVA Test Report

Run: `npm test` on Node 22.22, Playwright 1.56 + Chromium, Linux sandbox. Result after all five milestones (local model, ProofLoop, voice, daily use, delivery): **297 tests: 296 passed, 0 failed, 1 skipped** (about 6 minutes). Only tests that were executed are listed.

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
| Classic tools (unchanged) | earlier files | 144 pass, 1 skipped | calendar, .ics, collector, matching, Jobs for you, voice commands, Smart mode (mocked), layout, axe |

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

## Not tested (Milestone 4)

Real Gmail (needs your Google OAuth client with the Gmail API and NOVA_SECRET_KEY), a real phone receiving ntfy pushes, the scheduler running for days in real time, and classification accuracy on your own mail. How to verify each: README "Daily use" and NOVA_FEATURE_STATUS.md.

## Not tested (Milestone 3)

Real microphone accuracy, whether your browser offers "Andrew", Arabic recognition quality: run `NOVA_VOICE_TEST_SCRIPT.md` (10 minutes).

## Not tested (Milestones 1 and 2)

Real Ollama model accuracy (run `node scripts/eval-nlu.js --provider ollama --min 0.8` on your machine; the keyword-only baseline is 23%); real Claude; ProofLoop with real Gmail/calendar evidence (those connectors do not exist yet); automatic follow-ups (the scheduler is Milestone 4).
