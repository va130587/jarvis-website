# NOVA Architecture

Status after **Phase 2 (agent layer), Milestone 1 (free local model) and Milestone 2 (ProofLoop)**. Sections marked *(planned)* describe later phases and are **not built yet**.

## 1. System diagram

```
 Browser (plain HTML/CSS/JS, no build step)
 ┌──────────────────────────────────────────────────────────────┐
 │ index.html + app.css + nova.css                              │
 │ nova.js   sign-in gate, 13 NOVA pages, orb state store, API  │
 │ app.js / core.js / jobs.js / calendar.js / voice.js ...      │   Classic tools: data in this browser (localStorage)
 └───────────────▲──────────────────────────────────────────────┘
                 │ same origin: HttpOnly session cookie + X-NOVA-CSRF header
 ┌───────────────┴──────────────────────────────────────────────┐
 │ Node 22 server (server/index.js, no npm dependencies)        │
 │  http.js      router, JSON bodies, validation helpers        │
 │  security.js  CSP + headers, rate limiter, audit, redaction  │
 │  auth.js      Google OIDC (code+PKCE), dev login, sessions   │
 │  memory.js    Memory Vault, secret/sensitive checks, retrieval│
 │  chat.js      request pipeline, activity + usage records     │
 │  agent/       planner, tool registry, approvals, execution,  │
 │               verification, undo, run timeline               │
 │  ai/rules.js  free deterministic handlers                    │
 │  ai/claude.js model adapter (optional, paid, text only)      │
 │  db.js        SQLite (node:sqlite), versioned migrations     │
 └───────────────▲──────────────────────────────────────────────┘
                 │
          .nova/nova.db  (SQLite file, git-ignored)
```
*(planned)*  Gmail/Graph connectors (Phases 4 and 6), scheduler/worker (Phase 5).

Two ways to run the same front end:
- **NOVA server mode** (`node server/index.js`): sign-in, database, API. The front end detects `/api/session` and switches on the NOVA pages.
- **Static mode** (GitHub Pages or any file server): `nova.js` finds no server and does nothing; the classic Classic tools run exactly as before, with data in the browser.

## 2. Agent execution flow (implemented, Phases 1 and 2)

```
POST /api/chat
 1. rate limit, session -> user, CSRF + Origin, input validation
 2. fixed rules (who am I, remember -> proposal, time, help)          no AI, no cost
 3. otherwise agent.start():
      planner = built-in intent patterns (intents.js)  or  a model (if configured)  or  none -> honest message
      loop (max steps, run timeout):
        decide        planner proposes ONE tool call, or a final answer
        validate      tool must be in the registry; input must match its JSON schema
        permission    read -> run;  write -> ask unless "auto-approve low risk" is on;  destructive / external -> always ask
        approval      stored with a Future Preview (action, reason, target, what changes, consequences, undoable)
                      run pauses (status awaiting_approval); the person approves, rejects, edits or cancels
        execute       tool timeout; reads retried (max 3), changes never retried; one tool_executions row
        verify        the tool re-reads the state ("Read back from the database: ...");
                      a result that cannot be verified is reported as failed, never as done
        answer        summary + evidence; Undo offered only for reversible actions
 4. every step is stored in run_steps; activity and usage rows are written; audit entries for approvals, rejections, undo, cancel
```
`POST /api/approvals/:id/approve` re-checks everything on the server: the approval belongs to the signed-in user, is still pending and not expired, the run is still waiting, edited input validates, and it is claimed atomically so it can never run twice. The model never executes anything: it can only propose, and tool results are returned to it as marked untrusted data.

## 3. Identity and permissions

- **Sign-in:** Google OpenID Connect, authorization-code flow with PKCE and `state`/`nonce`; the code is exchanged server-side with the client secret; the ID token's issuer, audience, expiry and nonce are checked; the e-mail must be on `OWNER_EMAILS`. A loopback-only `AUTH_MODE=dev` exists for local use and tests (the server refuses to start in dev mode on a non-loopback host).
- **Sessions:** a random 256-bit id in an `HttpOnly; SameSite=Lax` cookie (`Secure` over HTTPS); only its SHA-256 hash is stored. Idle timeout (default 8 h) and absolute lifetime (default 7 days). Sessions can be listed and revoked. Removing an e-mail from the allow-list ends that user's sessions on the next request.
- **Authorisation:** every personal table has `user_id`; every query is scoped by the session's user id; foreign ids return 404 (tests cover read, change, delete and continue-chat attempts across users).
- **CSRF:** state-changing calls need `X-NOVA-CSRF` (value from `/api/session`) and a same-host `Origin` when present.
- Voice is never used for authentication.
- Spoken approval (`via: "voice"` on the approve call) is accepted only for risk `write` and undoable previews, never with edits; the server refuses anything else (403 `voice_not_allowed`) and audits both outcomes. `speech.js` holds voice ranking, approval parsing and a swappable recogniser provider (browser Web Speech today).

## 4. Database design (SQLite, migration 1)

| Table | Purpose |
|---|---|
| `users` | id, google_sub, email (unique), display_name, personalization flag, timestamps |
| `sessions` | hashed id, user_id, csrf, created/last_seen/expires, user agent |
| `oauth_states` | single-use state + nonce + PKCE verifier (10 min) |
| `memories` | user_id, kind, text, **source**, status (`active`/`proposed`), sensitive flag, created/updated/last_used |
| `conversations`, `messages` | chat history per user |
| `activity` | per request: request, operation, handler (`rules`/`claude`/`none`/`blocked`), tool, approval, evidence, status, result, failure |
| `tasks`, `notes` | data the agent's tools really create, change and (soft) delete, per user |
| `runs`, `run_steps` | one row per request that used the agent; ordered timeline of plain-English steps |
| `approvals` | pending / approved / rejected / expired / cancelled, input, preview, expiry, link to the execution |
| `tool_executions` | tool, input, status (succeeded / failed / unverified), evidence, undoable, attempts |
| `usage_ledger` | per request: handler, model, input/output/cache-read tokens, duration, ok, estimated cost |
| `audit_log` | security events (login, logout, memory changes, data deletion...) with secrets redacted |

All foreign keys cascade on user deletion. *(planned)* `commitments`, `evidence`, `connectors`, `jobs`, `skills`.

## 5. ProofLoop state machine (implemented)

```
Request Detected -> Request Understood -> Task Prepared -> Awaiting Approval -> Executing -> Submitted -> Awaiting Confirmation -> Verified -> Completed
   (Task Prepared -> Executing when auto-approved; Submitted -> Verified when the evidence already proves it; Failed and Cancelled from any open state, with a reason;
    for things OWED TO ME, Request Understood -> Awaiting Confirmation = "waiting for them")
```
One function (`server/proofloop/machine.js: transition`) decides every move and every move is logged in `commitment_events` (from, to, who, why, when). The honesty rules live there, not in the UI:
- **a draft is not an action** - only `submitted` evidence allows Submitted;
- **an API success or an acknowledgement is not proof** - only `verified` evidence allows Verified;
- **nothing is Completed unless it was Verified**; Failed and Cancelled need a reason; finished commitments cannot move.

Evidence kinds: draft, submitted, acknowledged, verified, note. A `verified` item is either checked against real stored state (`verify.js`: task / note / memory exists, task done) or is the owner's own confirmation, stored with `independent = false` and shown as "self-reported" everywhere (UI, receipt). The agent creates a commitment for a task with a deadline (and via `commitments.create` for things owed either way); after the task is created the commitment is **Awaiting Confirmation, not Verified**, because NOVA cannot see whether the real-world action happened. Proof receipts (`GET /api/commitments/:id/receipt`) list the timeline, evidence, tool runs and approvals and state what they do and do not prove.

Tables: `commitments`, `commitment_events`, `evidence` (+ `commitment_id` on `tool_executions` and `approvals`). Demo scenarios (`demo.js`) use the same machine and are removable (`is_demo`).

## 6. Email integration *(planned, Phase 4)*, scheduling *(planned, Phase 5)*

Gmail will start read-only over official OAuth, tokens encrypted at rest on the server, incremental sync, rule-based triage first and a cheap model second. Scheduling will use a jobs table and a worker loop with time zones, retries and idempotency keys.

## 7. Security controls (implemented)

Strict CSP (no inline or eval scripts), `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy; static file allow-list (the database, `server/`, tests and env files are never served); per-user and per-IP rate limits with `Retry-After`; JSON-only bodies with size limit (100 KB); strict field validation; audit log with token redaction; secrets only from environment variables; sensitive-memory rules (secrets refused, private details need confirmation); data export, deletion of memories, and deletion of the whole account.

## 8. Error handling

Typed `HttpError`s become `{error:{code,message}}` with the right status; unexpected errors are logged without request data and return a generic 500; a failed model call produces a safe reply, a `failed` activity row and no state change; the client returns to the sign-in screen if the session ends.

## 9. Token optimisation

Free rules answer common requests with zero tokens; only the top ≤5 relevant memories reach a model; short history window (12 messages, 2000 chars each); stable system prompt marked for prompt caching; low effort for everyday replies; one cheap model by default (`NOVA_MODEL_CHAT`); a monthly spending cap. The Usage page shows only measured token counts and clearly labelled cost *estimates*.

## 10. Known limitations

- Claude replies are verified only against an injected stand-in client; a real call needs an API key and has not been run. The Ollama (local model) provider is verified only against a stand-in server; real-model accuracy is measured by `node scripts/eval-nlu.js --provider ollama` on your machine.
- ProofLoop follow-up dates are stored but nothing acts on them until the scheduler exists; calendar/e-mail/file verification checks arrive with those connectors.
- Real Google sign-in is verified only against a stand-in Google; it needs your Client ID and a person.
- `node:sqlite` is marked experimental by Node; it is stable enough for one process but is a swap-able layer (`db.js`).
- One server process, in-memory rate limits; no automatic data-retention schedule; no backup automation (copy `.nova/nova.db` while the server is stopped, or use `sqlite3 .backup`).
- Classic tools (tasks, notes, calendar, jobs) still store data in the browser.

## 11. Future expansion

Tool registry and approvals, ProofLoop, Gmail and Outlook, scheduler, speech provider abstraction (browser engine now, Azure optional), Skill Studio, LifeGraph, Screen Vision, Postgres behind `db.js` for multi-tenant scale.

## Daily use (Milestone 4)

- `server/daily/clock.js`: Dubai time (always UTC+4, no daylight saving) and next-run calculation.
- `server/daily/scheduler.js`: per-person schedules (`schedules`) and runs (`schedule_runs`, unique on schedule + due time). Each hand-over is a compare-and-set UPDATE, so concurrent ticks or processes cannot run one occurrence twice. Retries: 3 attempts with 1/5/15-minute back-off; stuck runs (>10 min) are resumed; missed occurrences collapse into one run with a `missed` count. Jobs are plain functions and the clock is injected, so every rule is tested with a fake clock.
- `server/daily/briefing.js`: builds the briefing from tasks, commitments, approvals and e-mail (no model). Stored copies in `briefings`.
- `server/daily/notify.js`: `notifications` with a `dedupe` key (a retried job never notifies twice); optional ntfy push (topic from the environment only; never returned or logged).
- `server/daily/email.js` + `classify.js`: Gmail read-only (OAuth code + PKCE, `gmail.readonly` only, state bound to the signed-in user, tokens sealed with AES-256-GCM in `connections.token_enc`, refresh, revoke on disconnect). Only headers and Gmail's snippet are stored (`emails`); classification is rule-based with reasons; drafts (`email_drafts`) are never sent (the send endpoint always answers 403). E-mail text is untrusted: it is matched, never obeyed, and reaches a model only as tool-result data.
- Agent tools `briefing.today` and `email.list` are read-only, so "brief me" and "check my e-mail" need no approval.

## Knowledge, search and install (Milestone 6)

- `server/kb.js`: `documents` and `chunks` (passages split at headings and paragraphs, about 700 characters) with an SQLite FTS5 index (`chunks_fts`, porter stemming, BM25 ranking, headings weighted double). Query words are quoted before matching, so search syntax in a question cannot change the query. Answers are extractive: the best passage plus its document, heading and position; below a minimum word match the answer is "found nothing". The `kb.search` tool is read-only.
- `GET /api/search`: one per-user search across tasks, notes, memories, commitments, e-mail and documents (LIKE with escaped wildcards, plus FTS) for the Ctrl+K palette in `nova-plus.js`.
- `manifest.webmanifest`, `icons/`, `sw.js`: installable app. The service worker is network-first for the app's own files and never handles `/api/` or `/auth/`.

## Productivity (Milestone 7)

- `server/productivity.js`: `plan()` orders overdue tasks, overdue promises, today's tasks and promises, the next two days, then the oldest undated tasks; it places them from now (or the start of the day) in 15-minute steps with 10-minute gaps, keeps lunch free, adds a short break after 90 minutes and lists what does not fit. Estimates come from `tasks.estimate_min` or a labelled guess from the wording. Saved plans live in `day_plans`.
- `focus_sessions`: one running session per person; stopping early is "stopped", reaching the planned end is "completed"; a session left running more than an hour past its end is closed at its planned end.
- `insights()`: Monday-to-Sunday weeks in Dubai time; reliability = promises with a deadline closed on time, divided by those closed or overdue in the last 28 days (shown only from 3). Tools `plan.today` and `insights.week` are read-only.

## Life tracker (Milestone 8)

- `server/life.js`: `parseWhen` (Dubai time; relative, clock, parts of day, weekdays, daily / weekday repeats; "at 6" means 6 pm), `parseMoney` (fils, never floats), `categorize` (keyword rules). Tables `reminders`, `habits`, `habit_checks`, `expenses`, `budgets`.
- Reminders are delivered by `life.deliver()`, called on every scheduler tick: each delivery is a compare-and-set on (id, due time) plus a notification dedupe key, so two ticks or two processes cannot send one reminder twice. Repeating reminders move to their next time; reminders missed while NOVA was off are delivered late and say so.
- Budget alerts are notifications keyed by month and threshold, so each fires once. Tools `reminders.create`, `expenses.add`, `habits.check` (write, undoable, voice-approvable) and `expenses.summary` (read). A clock time in "remind me ..." selects a reminder; a date only keeps the task behaviour.

## Front end: design system, states and performance (hardening and redesign, Phases 0 to 6)

- **Styles in three layers:** `fonts.css` (self-hosted @font-face), `design.css` (tokens: colour as "R G B" triples, type scale, 4 px spacing, radius, elevation, motion; Deep Space on `:root`, Daylight on `:root[data-theme="light"]`; `.theme-dark` keeps a region dark in either theme), then `app.css` and `nova.css` (components, which only use tokens). See `DESIGN_SYSTEM.md`.
- **Boot:** `boot.js` (a file, so the strict CSP needs no inline script) applies the saved theme and hides the app shell (`html.nova-wait`) until `nova.js` has drawn NOVA's own layout, so nothing shifts on first load.
- **Data loading (`nova.js`):** `load()` shares one request per URL; data fetched in the last 2 s counts as fresh only for redraws of the same page; opening a page always refetches; any change (POST/PATCH/DELETE) makes everything stale and an older answer never replaces a newer one; `N.pending()` counts requests in flight. A failed first load shows `errorBox()` (offline / 429 / 5xx wording, Try again); the `online` event reloads; a 401 shows the sign-in screen with "Your session ended".
- **Task buttons:** `POST /api/actions` accepts only whitelisted tools (`tasks.complete`, `tasks.delete`) for the signed-in user's own tasks and goes through the normal agent run, so the preview, approval, verification and undo rules are unchanged.
- **Redraws keep focus:** `J.render()` restores focus by id, or for buttons without an id by `data-act` + `data-id`.
- **Motion:** page change 180 ms (+ at most 60 ms stagger); orb colours glide via registered custom properties; the ambient layer moves in steps (3 per second) so the blurred glass above it is not redrawn every frame; everything stops with reduced motion or a hidden tab.
