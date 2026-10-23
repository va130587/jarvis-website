# NOVA Feature Status

Honest status after **all five milestones** (local model, ProofLoop, voice, daily use, delivery). Statuses: WORKING AND TESTED, IMPLEMENTED BUT UNVERIFIED, DEMO ONLY, REQUIRES CONFIGURATION, NOT IMPLEMENTED, BLOCKED. "Tested" means an automated test was run and passed in this repository (see NOVA_TEST_REPORT.md).

| Feature | Status | Notes |
|---|---|---|
| NOVA brand, 19-page navigation in five groups (Today, Work, Life, Knowledge, System), phone bottom bar | WORKING AND TESTED | All 19 pages are live. Smoke walk at 390/768/1024/1440 in Deep Space and 390/1440 in Daylight: layout, console, requests and axe clean. How it *looks* is a judgement: see `docs/screenshots/after/`. |
| NOVA orb: idle, listening, transcribing, understanding, waiting approval, speaking, completed, error | WORKING AND TESTED | Set by real events: chat request lifecycle, proposal awaiting approval, errors, and the voice engine's state. Each state has its own text label; animation stops with reduced motion. |
| NOVA orb: planning, executing a tool, focusing | WORKING AND TESTED | Set by agent runs and focus sessions. All 11 states glide from one to the next (colour transition); reduced motion stops the movement. |
| Sign-in with Google (OIDC, PKCE) | IMPLEMENTED BUT UNVERIFIED | Fully tested against a stand-in Google (state, nonce, audience, expiry, allow-list, replay). Real Google needs your Client ID and a person: REQUIRES CONFIGURATION. |
| Development sign-in (local only) | WORKING AND TESTED | Allow-list enforced; refuses to start on a non-loopback host. |
| Sessions: HttpOnly cookie, hashed id, idle + absolute expiry, revoke, sign-out | WORKING AND TESTED | Fake-clock tests for both timeouts. |
| Backend authorisation, CSRF, Origin check | WORKING AND TESTED |  |
| Per-user database and account isolation | WORKING AND TESTED | Cross-user read/change/delete/continue attempts return 404; browser test with a second user. |
| Profile editing, personalisation switch | WORKING AND TESTED |  |
| Memory Vault: save, view with source and time, correct, delete, approve proposals | WORKING AND TESTED | Survives server restart (file database) and a new browser. |
| Never silently remember sensitive information | WORKING AND TESTED | Secrets (passwords, cards, keys, OTP) refused; private details need explicit confirmation; chat only proposes. |
| Relevant-only memory retrieval | WORKING AND TESTED | Keyword relevance, max 5. No semantic search yet. |
| NOVA chat with free built-in rules (identity, memory, time, help) | WORKING AND TESTED | 'Who am I' uses the signed-in account, not typed text. |
| NOVA chat with Claude | REQUIRES CONFIGURATION | Adapter tested with an injected stand-in client only (request shape, no tools, cached prompt, usage, failure, spending limit). Needs a paid API key and npm install @anthropic-ai/sdk. Never run against the real API. |
| Conversation history | WORKING AND TESTED |  |
| Activity panel in plain English (request, operation, handler, approval, evidence, status) | WORKING AND TESTED | Shown under each reply and on the Dashboard. |
| AI usage ledger and Usage page | WORKING AND TESTED | Real counts; cost is an estimate from a price table, only for known models. Spending cap tested with a stand-in model. |
| Security page: sessions, audit log, export, delete memories, delete account | WORKING AND TESTED | Typed confirmation required. |
| CSP, security headers, rate limiting, input validation, audit redaction, static allow-list | WORKING AND TESTED | Browser tests run under the strict CSP with zero violations. |
| Backup and restore (`npm run backup`, `npm run restore`) | WORKING AND TESTED | Consistent snapshot while running (VACUUM INTO), integrity check, manifest with SHA-256, pruning (`--keep`), safety copy before restore, damaged / changed / foreign files refused. Scheduling it daily is up to you (cron line in DEPLOYMENT.md). Automatic data-retention rules: NOT IMPLEMENTED. |
| Voice requests reach NOVA (typed path) | WORKING AND TESTED | Task, note, forget and memory-search phrases, and anything the Classic tools do not know, go to the server; changes show an approval request. In server mode these phrases no longer edit the browser-only NOVA tasks. |
| Voice page: push-to-talk (click or hold/Space), live editable transcript, confidence note, English UK/US and Arabic (UAE) selector, permission-denied / offline / network / no-speech / unsupported messages with a typing fallback | WORKING AND TESTED (mock engine) | 16 browser tests drive a controllable fake speech engine: normal, slow chunked, noisy (low confidence, never auto-sent), silence, denied, offline, wrong words corrected, repeated commands, no-recogniser and no-synthesis fallbacks, layout at 390/768/1440 and axe. |
| Voice: natural voice picker (prefers "Microsoft Andrew Online (Natural)" in Edge, then other natural voices; honest list; Test button) | WORKING AND TESTED (mock voices) | Ranking unit-tested. Whether your browser actually offers Andrew, and how it sounds, is UNVERIFIED until you run step 1-2 of NOVA_VOICE_TEST_SCRIPT.md. No "Andrew HD" voice exists in browsers today; NOVA says so rather than pretending. Free: the voices are part of Edge/Windows. |
| Spoken approval | WORKING AND TESTED | Only low-risk, undoable changes; a bare "yes" never approves; reject always allowed; destructive and external actions are button-only; enforced on the server (`via: voice` returns 403 otherwise) and audited. Voice is never authentication. |
| Voice: real microphone recognition accuracy | IMPLEMENTED BUT UNVERIFIED | Needs a person with a microphone. Run `NOVA_VOICE_TEST_SCRIPT.md` (10 minutes) and fill in the accuracy score. |
| ProofLoop state machine (11 states, validated transitions) | WORKING AND TESTED | Every one of the 2 x 11 x 11 from/to pairs is tested; owed-to-me commitments may start "waiting for them" early. |
| ProofLoop evidence rules | WORKING AND TESTED | A draft is not an action; submitted/acknowledged are not proof; Verified needs verified evidence; Completed needs Verified; closing needs a reason. |
| Verification checks (task, note, memory exist; task done; self-confirmation) | WORKING AND TESTED | Real stored state, scoped to the user. Self-confirmation is recorded as NOT independent. **Calendar, e-mail and file checks: NOT IMPLEMENTED** (those connectors do not exist yet). |
| Agent runs create and advance commitments (task with a deadline, owed-to-me, I-promised, confirm) | WORKING AND TESTED | Reject, cancel, expiry, undo, tool failure and failed verification each end the commitment honestly; "created" is Awaiting Confirmation, never "done". |
| Mission Control page, Dashboard panel, evidence chain, filters, manual add / move / evidence | WORKING AND TESTED | Browser tests incl. refusal to verify without proof, layout at 3 widths, axe, keyboard. |
| Proof receipts (Markdown download, printable HTML) | WORKING AND TESTED | State exactly what the evidence does and does not prove; hostile text is escaped. |
| ProofLoop demo mode (9 labelled fictional scenarios, Reset, Remove) | DEMO ONLY | Fictional data, but it runs through the real machine and database. |
| Follow-up dates on commitments | WORKING AND TESTED | Stored (day before the deadline; +3 days for things owed to you). The follow-up job nudges you once per follow-up date (fake-clock tested). NOVA never contacts anyone. |
| Tool registry with JSON-schema validation (10 tools: tasks, notes, memory, time) | WORKING AND TESTED | Unknown tools and invalid input are refused; the model sees only these tools. |
| Permissions and risk levels (read / write / destructive / external) | WORKING AND TESTED | Writes ask first unless you turn on auto-approve; destructive and external tools always ask (tested with a stand-in external tool). |
| Human approvals with Future Preview (action, reason, target, what changes, consequences, undoable?) and Approve / Reject / Edit / Cancel | WORKING AND TESTED | Backend verifies owner, state, expiry and edits; double approval never runs twice. |
| Execution, result inspection and verification | WORKING AND TESTED | Each change is re-read from the database; a result that cannot be verified is reported as failed, never as done. |
| Undo | WORKING AND TESTED | Only for reversible actions (create, complete, delete task; create note; add memory). Deleting a memory says plainly it cannot be undone. |
| Limits, timeouts, safe retries, cancellation | WORKING AND TESTED | Step limit, run and tool timeouts, reads retried up to 3 times, changes never auto-retried, in-flight model call aborted on cancel. |
| Run timeline and activity history in plain English | WORKING AND TESTED | Persisted steps per run; shown under each reply. |
| Free rule planner for task, note and memory requests | WORKING AND TESTED | Same intent list is shared by server and browser. |
| Local model provider (Ollama, free): tool calling, clarifying questions, setup/health status, reply badge | REQUIRES CONFIGURATION | Needs Ollama on your machine. Tested end to end against a stand-in Ollama server (call parsing incl. JSON-in-text, malformed arguments, timeout, offline, cancel, injection, request shape, status). **Real-model accuracy is UNVERIFIED** until you run `node scripts/eval-nlu.js --provider ollama`. |
| NLU eval set (65 phrasings, 11 categories incl. typos, Arabic-English mix, ambiguous, injection) and scorer | WORKING AND TESTED | Keyword-only baseline measured at 23% (15/65); an oracle stand-in scores 100% (harness check only, not a model accuracy claim). |
| Model planner (Claude tool calling) | REQUIRES CONFIGURATION | Tested end to end with a stand-in client: one tool call at a time, results returned as untrusted data, no forced tool choice, usage and estimated cost per call, injection attempt cannot skip approval. Never run against the real API (paid).
| Smart Email: classification with reasons (Critical / Important / Normal / Low / Check first), deadlines, promises, phishing guard | WORKING AND TESTED | Rule-based, free. Unit-tested and run on a labelled demo inbox (fictional) and on stand-in Gmail data. Accuracy on YOUR real mail is UNVERIFIED: run it for a week and judge. |
| Gmail read-only connection (OAuth + PKCE, gmail.readonly only, encrypted tokens, refresh, revoke, reconnect) | IMPLEMENTED BUT UNVERIFIED | Fully tested against a stand-in Google and Gmail API. Real Gmail needs your Google OAuth client, the Gmail API enabled and NOVA_SECRET_KEY: REQUIRES CONFIGURATION. Verify with the steps in README "Daily use". |
| E-mail reply drafts | WORKING AND TESTED | Template-based (no AI), editable, stored in NOVA only. Sending is NOT IMPLEMENTED on purpose: the send endpoint always refuses (403) because NOVA has read-only access. |
| Track an e-mail in ProofLoop | WORKING AND TESTED | Their promise -> owed to you; otherwise a reply you owe. Phishing messages cannot be tracked or drafted. |
| Outlook / Microsoft Graph on the server | NOT IMPLEMENTED | Phase 6. Browser-side Outlook calendar from NOVA still exists (IMPLEMENTED BUT UNVERIFIED). |
| Daily briefing (page, dashboard strip, "brief me", read aloud, saved history) | WORKING AND TESTED | Built from your data only; overdue, today, next three days, follow-ups, approvals, e-mail, phishing warning, "the one thing" with its reason. |
| Scheduler (Dubai time): briefing, deadline check, follow-up nudges, e-mail check | WORKING AND TESTED (fake clock) | No duplicates (unique key + compare-and-set, tested with concurrent ticks and two scheduler instances), retries 1/5/15 min then failed + notification, missed runs merged, stuck runs resumed, disabled jobs never run, run history. Runs only while the NOVA server process runs (it is not a cloud service). Long-running real-time behaviour is UNVERIFIED: leave NOVA running overnight and check Automation Centre > Run history. |
| Notifications: bell, browser pop-ups | WORKING AND TESTED | Bell, unread count, read / read all, pop-ups for new items when the browser allows them (tested with a stand-in Notification API). |
| Phone push via ntfy | IMPLEMENTED BUT UNVERIFIED | Tested against a stand-in ntfy server (headers, body, click link, failures recorded, topic never exposed). A real phone needs NOVA_NTFY_TOPIC and the ntfy app: REQUIRES CONFIGURATION. Verify: Automation Centre > Send a test notification. |
| Mission Autopilot, Skill Studio, Commitment Radar, LifeGraph, Screen Vision | NOT IMPLEMENTED | Phase 6 |
| Tasks, notes, calendar (browser), jobs, applications, growth, NOVA voice commands | WORKING AND TESTED | Unchanged; 144 earlier tests still pass. Data is in the browser, not the NOVA database yet. |
| Job collector (GitHub Action), ntfy alerts, Smart mode | REQUIRES CONFIGURATION | As before: fixture-tested, never run against the live internet. |
| CI running the tests | WORKING AND TESTED | GitHub Actions runs `npm test` and the speed and size guard on every push and pull request. |

## Delivery (Milestone 5)

| Feature | Status | Notes |
|---|---|---|
| `npm start` with a first-run setup page | WORKING AND TESTED | Loopback only, one-time code from the terminal, refuses cross-site posts, writes a private `.env` (mode 600, random NOVA_SECRET_KEY) once, then NOVA starts on the same address. Tested end to end in a child process and in a browser (axe, phone width). |
| Demo mode (`npm run demo`, `npm run demo:reset`) | WORKING AND TESTED | Separate database, fictional labelled data (tasks, notes, memories, 9 ProofLoop scenarios, 10 e-mails, a briefing). |
| NOVA_DEMO_GUIDE.md | WORKING AND TESTED | Every on-screen claim in the guide is checked by `tests/acceptance-e2e.test.js` on the demo data. The microphone part needs a person. |
| Dockerfile | WORKING AND TESTED (manually) | Built and run in this environment: health check endpoint answers, runs as user `node`, data in `/data`, image contains no tests, `.env` or database, development sign-in refused. Not part of `npm test`. |
| CI workflow (`.github/workflows/ci.yml`) | WORKING AND TESTED | Runs every test on GitHub for every push and pull request. Runs 1 and 4 each exposed a timing problem that the local machine did not show (a calendar test; reminder pop-ups hiding messages); both fixed, the second in the app itself. Check the Actions tab for the latest run. |
| DEPLOYMENT.md (home, always-on, Docker, free VM with HTTPS) | DOCUMENTATION | Steps are standard; only the local and Docker paths were executed here. |

## Knowledge, search and install (Milestone 6)

| Feature | Status | Notes |
|---|---|---|
| Knowledge Base: add notes or text files, ask, answer with the cited passage, "found nothing" when absent, open and delete documents, samples | WORKING AND TESTED | Full-text search with stemming and ranking (SQLite FTS5), no AI, so answers are quotes from your documents, never invented. Per-user, deleted documents leave the index. PDF and Word files are NOT supported (paste their text instead). |
| "What do my notes say about …" / "according to my documents …" by text or voice | WORKING AND TESTED | Read-only tool; hostile text inside a document is shown, never obeyed (tested). |
| Ctrl+K command palette | WORKING AND TESTED | Searches tasks, notes, memories, commitments, e-mail and documents; pages and quick actions; "> ask NOVA"; keyboard-only, focus returns on Escape; axe and layout at 3 widths. |
| Install as an app (manifest, icons, service worker, offline shell) | WORKING AND TESTED | Service worker registration and opening offline tested in Chromium. The browser's own install prompt cannot be clicked by a test: install it once yourself (Security and Settings explains how). |

## Productivity (Milestone 7)

| Feature | Status | Notes |
|---|---|---|
| Plan my day (time-blocked plan with reasons, lunch, breaks, what does not fit, your estimates or labelled guesses, saved plans) | WORKING AND TESTED | Fake-clock tests: order, reasons, no overlaps, lunch protected, after-hours plans tomorrow, short days, validation. It only suggests; it does not read your Google or Outlook calendar (those stay in the browser), so meetings are not taken into account yet. |
| Focus sessions (timer, orb state, top-bar chip, end notice by toast / voice / pop-up, history) | WORKING AND TESTED | One at a time; stop early, finish, or auto-closed at the planned end if you walk away. The end notice needs a NOVA tab open (the server records the session either way). |
| Weekly Insights (reliability score, done / on-time / focus vs last week, two charts with hover, keyboard and table views, sentences) | WORKING AND TESTED | Numbers checked against hand-built data. Reliability needs at least 3 promises in 4 weeks before it shows a score. |

## Life tracker (Milestone 8)

| Feature | Status | Notes |
|---|---|---|
| Timed reminders by sentence or form (relative, clock, tomorrow, weekdays, daily / weekday repeats), delivered by the server; cancel, "again in 10 minutes" | WORKING AND TESTED | Fake-clock tests: exact Dubai times, one delivery per occurrence even with concurrent ticks, repeats, late delivery after downtime. Delivery needs the NOVA server running (see DEPLOYMENT.md for always-on). Phone delivery needs ntfy configured. |
| Habits: check-ins (today and the last 6 days), current and best streak, weekday habits, 13-week heatmap, archive, "check in reading" | WORKING AND TESTED | |
| Money in AED: sentence or form, automatic category, month by category, vs last month, monthly budget with pace marker, alerts once at 80% and 100%, delete | WORKING AND TESTED | Amounts are stored as whole fils (no rounding errors). Categories are keyword rules: change one with the category menu. No bank connection (by design: free and private). |
| Design system (tokens), Deep Space and Daylight themes, remembered theme choice | WORKING AND TESTED | `design.css`, `DESIGN_SYSTEM.md`; theme test (keyboard, reload, back); axe contrast checks in both themes. |
| Error states on every page (offline, 401, 429, 500, slow) with Try again and automatic recovery | WORKING AND TESTED | `tests/error-states-e2e.test.js`; real network loss on a phone: UNVERIFIED (turn on airplane mode, open a page, turn it off). |
| Large data, Arabic and emoji | WORKING AND TESTED | 200 tasks, 200 e-mails, 100 documents, 100 notifications (`tests/stress-e2e.test.js`). |
| Race safety (double approval, fast switching, background redraws) | WORKING AND TESTED | `tests/race-e2e.test.js`; server claims an approval atomically. |
| Done and Delete buttons on NOVA tasks | WORKING AND TESTED | Preview and approval as in Chat (`POST /api/actions`, whitelisted tools only). |
| Performance budget (first content < 1 s, no layout shift, no task > 100 ms, frame cost < 16.7 ms) | WORKING AND TESTED (headless Chromium) | Measured about 0.2 s, 0.000, none, about 3 ms. On your own devices: UNVERIFIED (DevTools > Lighthouse and Performance panel; see NOVA_TEST_REPORT.md). |
| Installed-app theme on a phone (no light flash) | IMPLEMENTED BUT UNVERIFIED | Needs a real phone: install, choose Daylight, close and reopen. |
| Promise Orbit (dashboard): dots for open promises, deadlines and tasks, state by colour + shape + words, 12 dots then "+N more", list view | WORKING AND TESTED | `tests/server-orbit.test.js`, `tests/orbit-e2e.test.js` (200 items, keyboard, motion, 4 widths, both themes, axe). Slow motion; stops when hidden and with reduced motion. |
| Day Replay (what NOVA did on any Dubai day, time slider, read-only) | WORKING AND TESTED | `tests/server-replay.test.js`, `tests/replay-e2e.test.js`. Shows only records NOVA already keeps; a day before NOVA existed is empty. |
| Life Radar (five measures, this week vs last, rules written under the chart) | WORKING AND TESTED | `tests/server-radar.test.js`, `tests/radar-e2e.test.js`. A measure with no data is "not enough data yet". The 5-hour focus goal and the 10-points-per-overdue-item cost are fixed rules, stated on the page, not personal targets. |
| Proof receipt fingerprint, QR code, public check page (/verify) | WORKING AND TESTED | `tests/qr.test.js` (decoded with an independent reader), `tests/server-verify.test.js`, `tests/verify-e2e.test.js`. A match proves NOVA issued exactly that text; it does not prove the real-world action. **Scanning the QR with a real phone camera: UNVERIFIED** (see NOVA_TEST_REPORT.md). The check only knows receipts issued by this NOVA after this update. |
| "What happens if": Effects row in every approval preview | WORKING AND TESTED | `tests/server-effects.test.js`, `tests/effects-e2e.test.js`. Facts from your own data only; tools without effects say "No other effects found."; if the lookup fails the card says so. |

## The ten improvements (Parts 1 to 10)

| Feature | Status | Notes |
|---|---|---|
| Connect Gmail guide: exact redirect addresses, live checklist, plain cause-and-fix for every failure, Test connection, honest Disconnect | WORKING AND TESTED (stand-in Google) | `GET /api/gmail/setup`, `POST /api/gmail/test`; every Gmail request is a GET and the only permission is gmail.readonly. A real Google login is UNVERIFIED: see NOVA_TEST_REPORT.md |
| Can people rely on me? (promise reliability per person from ProofLoop, rule shown, "not enough data yet" below 3) and Before I promise (busy-week heads-up, also in Quick capture) | WORKING AND TESTED | Read-only `GET /api/proofloop/trust` and `GET /api/proofloop/heads-up`; exact numbers on a fixture, Dubai-date boundaries, other users never counted |
| What if I say yes? simulator: clashes, free hours, tight tasks and promises, most at-risk item, rules shown, nothing written; Add it for real via Quick capture | WORKING AND TESTED | `POST /api/whatif` (read-only). Real Google or Outlook calendars are UNVERIFIED: tested with calendar events supplied by the browser |
| Weekly Review page (last full Dubai week: finished tasks, promises, focus, habits, spending vs budget, what slipped, three priorities with rules; copy and Markdown download) and the optional Sunday 18:00 notification (off by default, one per week) | WORKING AND TESTED | Read-only `GET /api/review?week=`; exact numbers on a fixture week, Dubai-midnight edges, empty week, other users never counted, job deduplicated |
| Help page and Check my setup | WORKING AND TESTED | Read-only `GET /api/check`: Node, data, daily jobs, notifications, Gmail, AI model; each OK, Needs attention (exact next step) or Not set up (why that is fine). No paths, secrets or addresses are returned. A test fails if any error message contains a code, "undefined", "[object", "Error:" or a file path (found and fixed 17 developer-style messages). |
| First-run tour | WORKING AND TESTED | Six steps in a real `<dialog>`; remembered per account in the database (migration 9; people who already had an account are marked done); Esc skips; focus returns; "Show the tour again". |
| Readable export and safe import | WORKING AND TESTED | Markdown copy; import is preview (counts, duplicates, refused items, notes) then Approve, in one transaction, into your account only; never sessions, tokens, e-mail, other accounts' ids or proof evidence; "verified" commitments return as "awaiting confirmation" because proof is not imported. Limits: 6 MB, 5,000 items. |
| Automatic backups | WORKING AND TESTED | Backup job 03:30 Dubai, once a day, keeps 14; checked copies with a fingerprint; "Test my latest backup" restores into a temporary place and counts only your own items; the live database is not touched; dashboard warning after 7 days. The copy is on the same computer: copy the folder elsewhere. |
| Undo list | WORKING AND TESTED | Your last 20 changes with plain reasons where undoing is impossible; Undo needs a preview and approval; "What happens if" facts for the undo; double-click safe; only your own changes. The older one-click Undo button on a chat result still exists. |
| Calendar-aware planner | WORKING AND TESTED with an imported .ics file and fake events; REAL GOOGLE / OUTLOOK ACCOUNTS UNVERIFIED | Only the planned day's events are sent with the request; they become fixed blocks; free gaps between meetings are used; all-day events are only mentioned; nothing is stored (a saved plan keeps "Busy (calendar)" without titles); NOVA never writes to a calendar. |
| Voice on more browsers | WORKING AND TESTED with browser profiles and a fake audio source; REAL MICROPHONES, SAFARI AND FIREFOX UNVERIFIED | A plain sentence per browser, Type or paste where it cannot listen (same approval rules), 10-second microphone test (level meter, nothing recorded, microphone released). |
| Livelier demo and guided demo | WORKING AND TESTED | 14 days of fictional activity at different hours, a verified receipt, a budget near 80%, habits with streaks 9 and 3, all labelled demo; seeding twice changes nothing; correct at any time of day or month (tested at four clocks). Five-step banner remembered per account. |
| gzip, ETag and the speed and size guard | WORKING AND TESTED | `server/static.js` (zlib only); `/api/` and `/auth/` are never compressed or cached; `npm run perf` and a CI step fail on slow first content, layout shift, a 100 ms task, a first page more than 15% above its saved size, or a new file over 200 KB. |
| Accessibility options and pass | WORKING AND TESTED with axe and keyboard checks; SCREEN READERS UNVERIFIED | One h1 and no skipped levels on all 19 pages, skip links (also on the public pages), focus on the page title after each page change with a polite announcement, High contrast (7:1 text), Larger text 125% / 150%, no broken layout from 390 to 1440 px. See `docs/ACCESSIBILITY_CHECKLIST.md`. |
