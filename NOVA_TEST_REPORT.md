# NOVA Test Report

Run: `npm test` on Node 22.22, Playwright 1.56 + Chromium, Linux sandbox. Result after Milestone 1 (local model) and Milestone 2 (ProofLoop): **243 tests: 242 passed, 0 failed, 1 skipped** (about 290 seconds). Only tests that were executed are listed.

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

## Not tested (Milestones 1 and 2)

Real Ollama model accuracy (run `node scripts/eval-nlu.js --provider ollama --min 0.8` on your machine; the keyword-only baseline is 23%); real Claude; ProofLoop with real Gmail/calendar evidence (those connectors do not exist yet); automatic follow-ups (the scheduler is Milestone 4).
