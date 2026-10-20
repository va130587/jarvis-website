# NOVA Feature Status

Honest status after **Milestones 1 (local model), 2 (ProofLoop) and 3 (voice)**. Statuses: WORKING AND TESTED, IMPLEMENTED BUT UNVERIFIED, DEMO ONLY, REQUIRES CONFIGURATION, NOT IMPLEMENTED, BLOCKED. "Tested" means an automated test was run and passed in this repository (see NOVA_TEST_REPORT.md).

| Feature | Status | Notes |
|---|---|---|
| NOVA brand, premium dark UI, 13-page navigation | WORKING AND TESTED | Live pages are real; Smart Email, ProofLoop, Automation Centre, Knowledge Base are labelled Soon/Upcoming. Layout at 390/768/1440 and axe (no serious issues) executed. 'Premium' look is a judgement, see screenshots. |
| NOVA orb: idle, listening, transcribing, understanding, waiting approval, speaking, completed, error | WORKING AND TESTED | Set by real events: chat request lifecycle, proposal awaiting approval, errors, and the voice engine's state. Each state has its own text label; animation stops with reduced motion. |
| NOVA orb: planning, executing a tool | DEMO ONLY | Visuals exist; nothing triggers them until the agent and tools arrive in Phase 2. |
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
| Automatic data-retention schedule, backup automation | NOT IMPLEMENTED | Manual export and deletion exist; backup guidance is in ARCHITECTURE.md. |
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
| Follow-up dates on commitments | IMPLEMENTED BUT UNVERIFIED | Stored (day before the deadline; +3 days for things owed to you). Nothing acts on them until the scheduler (Milestone 4). |
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
| Gmail, email classification, deadlines, drafts | NOT IMPLEMENTED | Phase 4 |
| Outlook / Microsoft Graph on the server | NOT IMPLEMENTED | Phase 6. Browser-side Outlook calendar from NOVA still exists (IMPLEMENTED BUT UNVERIFIED). |
| Automation engine, scheduler, daily briefing | NOT IMPLEMENTED | Phase 5 |
| Mission Autopilot, Skill Studio, Commitment Radar, LifeGraph, Screen Vision | NOT IMPLEMENTED | Phase 6 |
| Tasks, notes, calendar (browser), jobs, applications, growth, NOVA voice commands | WORKING AND TESTED | Unchanged; 144 earlier tests still pass. Data is in the browser, not the NOVA database yet. |
| Job collector (GitHub Action), ntfy alerts, Smart mode | REQUIRES CONFIGURATION | As before: fixture-tested, never run against the live internet. |
| CI running the tests | NOT IMPLEMENTED |  |
