# NOVA Architecture

Status after **Phase 1 (core foundation)**. Sections marked *(planned)* describe later phases and are **not built yet**.

## 1. System diagram

```
 Browser (plain HTML/CSS/JS, no build step)
 ┌──────────────────────────────────────────────────────────────┐
 │ index.html + app.css + nova.css                              │
 │ nova.js   sign-in gate, 13 NOVA pages, orb state store, API  │
 │ app.js / core.js / jobs.js / calendar.js / voice.js ...      │   Jarvis tools: data in this browser (localStorage)
 └───────────────▲──────────────────────────────────────────────┘
                 │ same origin: HttpOnly session cookie + X-NOVA-CSRF header
 ┌───────────────┴──────────────────────────────────────────────┐
 │ Node 22 server (server/index.js, no npm dependencies)        │
 │  http.js      router, JSON bodies, validation helpers        │
 │  security.js  CSP + headers, rate limiter, audit, redaction  │
 │  auth.js      Google OIDC (code+PKCE), dev login, sessions   │
 │  memory.js    Memory Vault, secret/sensitive checks, retrieval│
 │  chat.js      request pipeline, activity + usage records     │
 │  ai/rules.js  free deterministic handlers                    │
 │  ai/claude.js model adapter (optional, paid, text only)      │
 │  db.js        SQLite (node:sqlite), versioned migrations     │
 └───────────────▲──────────────────────────────────────────────┘
                 │
          .nova/nova.db  (SQLite file, git-ignored)
```
*(planned)* tool registry and approval layer (Phase 2), ProofLoop engine (Phase 3), Gmail/Graph connectors (Phases 4 and 6), scheduler/worker (Phase 5).

Two ways to run the same front end:
- **NOVA server mode** (`node server/index.js`): sign-in, database, API. The front end detects `/api/session` and switches on the NOVA pages.
- **Static mode** (GitHub Pages or any file server): `nova.js` finds no server and does nothing; the classic Jarvis tools run exactly as before, with data in the browser.

## 2. Agent execution flow (Phase 1, implemented)

```
POST /api/chat
 1. rate limit (per user)            security.js
 2. session cookie -> user           auth.js        (identity is never taken from the request body)
 3. CSRF token + Origin check        index.js
 4. validate input (type, length)    http.js
 5. rule match?  ──yes──► deterministic handler (identify_user, list/propose memory, time, help...) – no AI, no cost
        │no
 6. retrieve relevant memories       memory.js      (only if personalisation is on; max 5; keyword relevance)
 7. model configured?  ──no──► honest message: "I can answer that only when an AI model is connected"
        │yes
 8. spending limit check             chat.js        (estimated monthly cost from the usage ledger)
 9. model call (text only, no tools) ai/claude.js   stable system prompt cached, memories passed as DATA
10. store messages, activity row (operation, handler, approval, evidence, status), usage row (tokens, duration, est. cost)
11. reply + plain-English "what NOVA did" steps
```
The model can only write text in this phase. A "remember that…" request creates a **proposed** memory; it becomes active only when the person approves it (`POST /api/memories/:id/approve`). The model never executes anything. *(planned, Phase 2)* tool calling will add: schema validation, permission check, stored approval, execution, result inspection, verification.

## 3. Identity and permissions

- **Sign-in:** Google OpenID Connect, authorization-code flow with PKCE and `state`/`nonce`; the code is exchanged server-side with the client secret; the ID token's issuer, audience, expiry and nonce are checked; the e-mail must be on `OWNER_EMAILS`. A loopback-only `AUTH_MODE=dev` exists for local use and tests (the server refuses to start in dev mode on a non-loopback host).
- **Sessions:** a random 256-bit id in an `HttpOnly; SameSite=Lax` cookie (`Secure` over HTTPS); only its SHA-256 hash is stored. Idle timeout (default 8 h) and absolute lifetime (default 7 days). Sessions can be listed and revoked. Removing an e-mail from the allow-list ends that user's sessions on the next request.
- **Authorisation:** every personal table has `user_id`; every query is scoped by the session's user id; foreign ids return 404 (tests cover read, change, delete and continue-chat attempts across users).
- **CSRF:** state-changing calls need `X-NOVA-CSRF` (value from `/api/session`) and a same-host `Origin` when present.
- Voice is never used for authentication.

## 4. Database design (SQLite, migration 1)

| Table | Purpose |
|---|---|
| `users` | id, google_sub, email (unique), display_name, personalization flag, timestamps |
| `sessions` | hashed id, user_id, csrf, created/last_seen/expires, user agent |
| `oauth_states` | single-use state + nonce + PKCE verifier (10 min) |
| `memories` | user_id, kind, text, **source**, status (`active`/`proposed`), sensitive flag, created/updated/last_used |
| `conversations`, `messages` | chat history per user |
| `activity` | per request: request, operation, handler (`rules`/`claude`/`none`/`blocked`), tool, approval, evidence, status, result, failure |
| `usage_ledger` | per request: handler, model, input/output/cache-read tokens, duration, ok, estimated cost |
| `audit_log` | security events (login, logout, memory changes, data deletion...) with secrets redacted |

All foreign keys cascade on user deletion. *(planned)* `commitments`, `tool_executions`, `approvals`, `evidence`, `connectors`, `jobs`, `skills`.

## 5. ProofLoop state machine *(planned, Phase 3)*

`Request Detected → Request Understood → Task Prepared → Awaiting Approval → Executing → Submitted → Awaiting Confirmation → Verified → Completed`, with `Failed` and `Cancelled` reachable from any non-terminal state. Transitions will be validated in one function and persisted with evidence. Rules: a draft is not a sent email; an API success is `Submitted`, not `Verified`; an acknowledgement is not proof of acceptance. The Dashboard shows this as an **Upcoming** panel until then.

## 6. Email integration *(planned, Phase 4)*, scheduling *(planned, Phase 5)*

Gmail will start read-only over official OAuth, tokens encrypted at rest on the server, incremental sync, rule-based triage first and a cheap model second. Scheduling will use a jobs table and a worker loop with time zones, retries and idempotency keys.

## 7. Security controls (implemented)

Strict CSP (no inline or eval scripts), `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy; static file allow-list (the database, `server/`, tests and env files are never served); per-user and per-IP rate limits with `Retry-After`; JSON-only bodies with size limit (100 KB); strict field validation; audit log with token redaction; secrets only from environment variables; sensitive-memory rules (secrets refused, private details need confirmation); data export, deletion of memories, and deletion of the whole account.

## 8. Error handling

Typed `HttpError`s become `{error:{code,message}}` with the right status; unexpected errors are logged without request data and return a generic 500; a failed model call produces a safe reply, a `failed` activity row and no state change; the client returns to the sign-in screen if the session ends.

## 9. Token optimisation

Free rules answer common requests with zero tokens; only the top ≤5 relevant memories reach a model; short history window (12 messages, 2000 chars each); stable system prompt marked for prompt caching; low effort for everyday replies; one cheap model by default (`NOVA_MODEL_CHAT`); a monthly spending cap. The Usage page shows only measured token counts and clearly labelled cost *estimates*.

## 10. Known limitations

- Claude replies are verified only against an injected stand-in client; a real call needs an API key and has not been run.
- Real Google sign-in is verified only against a stand-in Google; it needs your Client ID and a person.
- `node:sqlite` is marked experimental by Node; it is stable enough for one process but is a swap-able layer (`db.js`).
- One server process, in-memory rate limits; no automatic data-retention schedule; no backup automation (copy `.nova/nova.db` while the server is stopped, or use `sqlite3 .backup`).
- Jarvis tools (tasks, notes, calendar, jobs) still store data in the browser.

## 11. Future expansion

Tool registry and approvals, ProofLoop, Gmail and Outlook, scheduler, speech provider abstraction (browser engine now, Azure optional), Skill Studio, LifeGraph, Screen Vision, Postgres behind `db.js` for multi-tenant scale.
