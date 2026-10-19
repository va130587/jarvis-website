# NOVA Implementation Plan

Status: **proposal, awaiting decisions in section 8.** Written from the real code (see `NOVA_AUDIT.md`). One phase per session; no phase starts until Roshan says "continue".

## 1. Target architecture (summary)

```
Browser (existing static front end, extended)          Node 22 backend (new, one process, modular)
  NOVA UI pages, orb, voice (SpeechProvider)   <--->     HTTP API + static files (same origin, cookie sessions)
                                                         auth/        Google OIDC, sessions, owner allow-list
                                                         memory/      Memory Vault, relevance retrieval
                                                         ai/          Provider interface (Claude adapter), router, usage ledger
                                                         agent/       planner loop, tool registry, validation, approvals
                                                         proofloop/   state machine, evidence, commitments
                                                         connectors/  gmail/, graph/ (calendar), each with status/scopes/disconnect
                                                         scheduler/   job table + worker loop, retries, dedupe
                                                         security/    CSP, rate limit, audit log, secret handling
                                                         db/          SQLite (node:sqlite or better-sqlite3), migrations
```

Principles: the **backend is the authority** (UI never decides permissions); the model only *proposes* tool calls, the backend validates and executes; modular folders, no microservices; every table has `user_id`; every external action goes through the approval layer; the AI provider sits behind an interface so the model can change.

## 2. Reuse map

| Existing | Becomes |
|---|---|
| `match.js` (rule-based explainable scoring) | pattern for the deterministic email classifier and deadline extractor |
| `voice.js` recognition + synthesis + orb canvas | `SpeechProvider` (browser) + 10-state orb |
| `calendar.js` REST logic | server-side Google/Graph connectors (tokens leave the browser) |
| `core.js` date/task parsing | shared parsing library (UMD, used by server too) |
| `tests/helpers.js`, Playwright harness | extended with auth, AI and Gmail mocks |
| `app.css` tokens | NOVA palette (navy/cyan/purple) |
| `scripts/collect-jobs.js`, Jobs for you | stays as an optional module ("Career" connector) |
| `blueprint/` | untouched |

## 3. Decision brief A: backend and hosting (cost, fit)

Prices are from my knowledge and **must be re-checked before purchase (unverified, I could not look them up in this session)**.

| Option | How it fits | Approx. cost | Pros | Cons |
|---|---|---|---|---|
| **A. Node 22 + SQLite on one small always-on host** (Fly.io machine, Railway, or a ~$5 VPS), serving the existing static files from the same server | Same language as the repo; no build step; built-in `node:sqlite` or `better-sqlite3`; a simple in-process scheduler works because the process stays up | about $4-7 per month; **$0 if run locally on your laptop for demos** | Smallest change, same origin (HttpOnly cookies, no CORS), easy to explain to an architect, easy tests | You operate one server; SQLite needs a persistent disk and a backup routine |
| B. Cloudflare Workers + D1 + Cron Triggers | Front end on Workers/Pages, API in Workers | free tier possible; paid plan about $5 per month | Cheap, no server to patch, built-in cron | Different runtime (no long-lived process, no filesystem), D1 limits, rewriting tests' server harness |
| C. Supabase (Postgres, Auth with Google, row-level security, Edge Functions) | Auth and DB handled for you | free tier (projects pause when idle, bad for a demo); Pro about $25 per month | Auth + RLS out of the box | Vendor lock-in; logic split across Edge Functions; paused free projects; more to explain |

**Recommendation: A**, in two steps: (1) develop and demo **locally** (`npm start`, `http://localhost:8787`, Google OAuth works on localhost) so Phase 1 to 3 cost nothing; (2) deploy the same code to a ~$5 host when customers or remote demos need it. SQLite is swapped for Postgres behind a thin `db/` layer later if multi-tenant scale requires it.

Effect on the earlier "100% free, no server" rule: **it ends for NOVA.** Free pieces that remain: GitHub (code, Actions job collector), browser speech, Google OAuth, Gmail API. New costs: hosting (about $0 local, about $5 per month deployed) and Claude API usage (section 4).

Impact on GitHub Pages: the NOVA app is served by the Node server. Pages can keep hosting `blueprint/` and the static Jarvis demo if wanted.

## 4. Decision brief B: Claude API cost

Prices from the current model table in the API skill (cached 2026-10-06, **re-verify on the pricing page before relying on them**): Haiku 5.5 $0.10 in / $0.50 out per MTok (prompts up to 100K); Sonnet 5.5 $2 / $10 (cache reads $0.20); Opus 5.5 $4 / $20 (cache reads $0.20). Thinking tokens bill as output tokens.

**Recommended model roles** (all behind the provider interface, configurable by env var):
- Classification, deadline extraction, triage: `claude-haiku-5-5`, effort `low`.
- Chat, drafts, briefings: `claude-sonnet-5-5`, effort `medium`.
- Mission planning and hard multi-step work: `claude-opus-5-5`, effort `medium`, used rarely.
- Screen Vision: a vision-capable model (Sonnet 5.5; confirm image support at build time).

**Estimates.** These use *assumed* token sizes, not measurements. The Cost Monitor (P6) will replace them with real numbers.

| Operation | Assumed tokens (in / out) | Model | Cost each |
|---|---|---|---|
| Chat turn with memory | 2,500 / 400 | Sonnet 5.5 | about $0.009 |
| Email classification | 800 / 100 | Haiku 5.5 | about $0.00013 |
| Reply draft | 1,500 / 300 | Sonnet 5.5 | about $0.006 |
| Daily briefing | 6,000 / 800 | Sonnet 5.5 | about $0.02 |
| Mission (about 4 planning steps) | 8,000 / 1,500 per step | Opus 5.5 | about $0.25 |

- **Whole mentor demo** (about 40 chat turns, 100 emails classified, 10 drafts, 3 missions): roughly **$1 to $2**.
- **Light daily use** (30 chat turns, 100 classifications, 10 drafts, 1 briefing): about **$0.36 per day, about $11 per month**; with 2 Opus missions a day about **$0.86 per day, about $26 per month**.
- Prompt caching (system prompt + tools) and rule-based pre-filtering (promotions, newsletters never reach Claude) reduce this; savings will only be reported from measured `usage` fields.
- **Claude Code subscription versus API billing:** your Claude Code plan pays for building NOVA in sessions like this one. A deployed NOVA calls the Claude API with its own key and is billed separately per token to an API account; the two do not share usage or limits.

Required controls (P1/P6): API key only in an environment variable on the server, monthly spending cap in app settings (hard stop), per-request token and step limits, usage ledger table.

## 5. Decision brief C: voice

| | Browser Web Speech API (current) | Azure AI Speech |
|---|---|---|
| Cost | free | free tier about 5 audio hours per month, then about $1 per audio hour (**verify**); neural voices extra |
| Setup | none | Azure account, key kept on the server, short-lived token endpoint, SDK in the page |
| Accuracy | good for clear English in Chrome/Edge/Safari; no vocabulary control; no guarantees | generally stronger, supports phrase lists and more languages |
| Privacy | Chrome/Edge send audio to the browser vendor's cloud service | audio goes to Microsoft under your contract |
| Browser support | Chrome, Edge, Safari; **not Firefox** | all modern browsers |
| Offline | no (needs internet in Chrome/Edge) | no |
| Reliability | `continuous` mode is flaky (current wake mode) | stable streaming |

**Recommendation:** keep the free browser engine as the default, make **push-to-talk** the primary mode (wake word stays optional and clearly "experimental"), and wrap recognition in a `SpeechProvider` interface so Azure can be added in Phase 5 if real-world accuracy is not good enough. Add visible, editable transcript, confidence display, permission-denied and offline messages, and a text fallback. Never claim 100% accuracy; voice is never authentication.

## 6. Phases, files, acceptance criteria, tests

Common to every phase: update `NOVA_FEATURE_STATUS.md`, `NOVA_TEST_REPORT.md`; run the whole existing suite (must stay green); commit.

### P1 Core foundation
- **Build:** `server/` (Node, `index.js`, `db/`, `auth/`, `memory/`, `ai/`, `security/`); NOVA shell and tokens (`app.css` extended), 13-page nav with "Upcoming" labels, orb states bound to a small state store; Google OIDC login (code flow + PKCE), HttpOnly session cookie, server-side session table with expiry, owner allow-list; profile and Memory Vault (`memories` table: text, source, created/updated, sensitive flag, user approval); Claude chat endpoint with history and relevance retrieval; CSP, rate limiting, validation, audit log; `.env.example`.
- **Acceptance:** sign in/out and session expiry work; a second test user cannot read the first user's rows; memories survive server restart and browser restart; disabling personalisation stops retrieval; "who am I" answers only from stored fields; chat works with a **mocked** Claude (CI) and a real key when configured.
- **Tests:** API auth/authorisation tests, isolation tests, memory persistence, CSP and hostile-HTML escaping tests, Playwright for nav, orb states, layouts 390/768/1440, axe.

### P2 Real AI agent
- **Build:** `ai/provider.js` interface + Claude adapter; `agent/` tool registry (JSON-schema validated), permission check, approval objects (Future Preview fields), step/token/time limits, timeout, cancellation, safe retries, activity log; untrusted-content wrapping.
- **Acceptance:** model proposes a tool call, backend validates and executes only approved tools; a sensitive tool cannot run without a stored approval; invalid input is rejected; step limit stops a looping model; instructions inside tool output cannot widen permissions.
- **Tests:** scripted fake-model transcripts (deterministic), injection fixtures, limit tests, cancellation tests.

### P3 ProofLoop
- **Build:** `proofloop/` state machine (Request Detected → Understood → Task Prepared → Awaiting Approval → Executing → Submitted → Awaiting Confirmation → Verified → Completed; Failed, Cancelled), `commitments`, `tool_executions`, `approvals`, `evidence` tables; dashboard and Mission Control views; demo scenarios (university request, client proposal, interview invite, promo, pending reply, overdue, completed, failed tool, rejected approval) driving real state changes.
- **Acceptance:** illegal transitions rejected; "draft" never equals "sent"; send success lands in Submitted, not Verified; Verified requires attached evidence; overdue and owes-me/I-owe views computed from stored rows.
- **Tests:** exhaustive transition table tests, evidence rules, demo walkthrough e2e.

### P4 Email intelligence
- **Build:** `connectors/gmail` (read-only scope, token encryption at rest AES-256-GCM, incremental sync by history id), classifier (rules first, Haiku second), deadline/action extraction, task generation, draft replies (review/edit/regenerate/reject), send disabled until a separate scope + approval is configured.
- **Acceptance:** classification always shows a reason; low-confidence mail is "Needs Review"; user correction is stored and reused; no send/delete/archive code path without approval.
- **Tests:** recorded Gmail API fixtures; classifier table tests like `match.test.js`; injection emails; **live test only when a Google client is configured (otherwise marked REQUIRES CONFIGURATION)**.
- **Caveat:** Gmail read access is a Google *restricted* scope. For test users on an unverified app, refresh tokens expire after about 7 days; serving other customers requires Google verification and a security assessment. Fine for the mentor demo; a real go-to-market item.

### P5 Automation and voice
- **Build:** `scheduler/` (jobs table, worker loop, time zones, retry with backoff, idempotency keys, run history); automations (daily briefing, deadline and pending-reply reminders, ProofLoop follow-ups); `SpeechProvider` push-to-talk with editable transcript, language choice, text fallback.
- **Acceptance:** a job runs once with the browser closed; duplicate runs prevented after restart; failures retry then record; permission-denied/offline messages shown.
- **Tests:** fake-clock scheduler tests, restart tests; speech mock matrix (silence, denial, offline, repeated command); the **real microphone cannot be tested here** and will be marked IMPLEMENTED BUT UNVERIFIED until Roshan tests it.

### P6 Advanced (isolated modules)
Mission Autopilot (real timeline from execution records), Skill Studio (declarative triggers/conditions/allowed actions, no generated code), Commitment Radar, LifeGraph (relational links with source references only), Screen Vision (type/size validation, vision model, uncertainty), Outlook/Graph connector, Cost Monitor with real usage and spending limit. Each behind a feature flag so the core is unaffected.

### P7 Quality and presentation
Security review, accessibility (axe), performance, deployment docs, backup/restore guidance, `ARCHITECTURE.md`, `NOVA_TEST_REPORT.md`, `NOVA_DEMO_GUIDE.md`, reproducible demo mode (fictional data only, no real mail or credentials).

## 7. Risks

- Google OAuth consent screen: unverified app limits (7-day refresh tokens, 100 test users); fine for the demo.
- Sandbox blocks many external hosts, so Google, Claude and Azure calls can only be verified with Roshan's own credentials on his machine.
- Scope: 13 pages is a lot; pages for later phases will be honestly labelled "Upcoming".
- Moving personal data off the browser creates privacy duties (retention, deletion, audit) that the browser-only Jarvis did not have.

## 8. Decisions needed from Roshan

1. **Backend:** go with option A (Node + SQLite, local first, about $5 per month when deployed)? Or B or C?
2. **Hosting for the demo:** local laptop only, or a small paid host?
3. **Claude API:** OK to create an API key and set a monthly cap (suggest $10 to start)? Until then P1 to P3 use a mock model.
4. **Naming and scope of the repo:** convert this repository in place (Jarvis becomes NOVA, job assistant kept as a module), or start a new `nova` repository that reuses the code?
5. **Google Cloud project:** can you create an OAuth client (localhost redirect) and add yourself as a test user when P1 reaches sign-in?
6. **Voice:** accept browser speech with push-to-talk as the default, Azure optional later?
7. **Single owner or multi-user from day one?** Recommendation: data model is multi-user; sign-in restricted to an allow-list of Google accounts (you) until P7.
