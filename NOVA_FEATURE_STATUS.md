# NOVA Feature Status

Honest status after **Phase 1**. Statuses: WORKING AND TESTED, IMPLEMENTED BUT UNVERIFIED, DEMO ONLY, REQUIRES CONFIGURATION, NOT IMPLEMENTED, BLOCKED. "Tested" means an automated test was run and passed in this repository (see NOVA_TEST_REPORT.md).

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
| Voice requests reach NOVA (typed path) | WORKING AND TESTED | Unknown phrases go to the server chat. |
| Voice: real microphone speech recognition | IMPLEMENTED BUT UNVERIFIED | Browser Web Speech engine; no real-microphone test; accuracy unmeasured. Editing transcript and language choice: NOT IMPLEMENTED (Phase 5). |
| Tool registry, structured tool calls, human approvals, Future Preview, undo | NOT IMPLEMENTED | Phase 2 |
| ProofLoop (state machine, evidence, commitments) | NOT IMPLEMENTED | Phase 3. The Dashboard shows an Upcoming panel only. |
| Gmail, email classification, deadlines, drafts | NOT IMPLEMENTED | Phase 4 |
| Outlook / Microsoft Graph on the server | NOT IMPLEMENTED | Phase 6. Browser-side Outlook calendar from Jarvis still exists (IMPLEMENTED BUT UNVERIFIED). |
| Automation engine, scheduler, daily briefing | NOT IMPLEMENTED | Phase 5 |
| Mission Autopilot, Skill Studio, Commitment Radar, LifeGraph, Screen Vision | NOT IMPLEMENTED | Phase 6 |
| Demo mode with NOVA scenarios | NOT IMPLEMENTED | Phase 3 onward. Jarvis sample data remains. |
| Tasks, notes, calendar (browser), jobs, applications, growth, Jarvis voice commands | WORKING AND TESTED | Unchanged; 144 earlier tests still pass. Data is in the browser, not the NOVA database yet. |
| Job collector (GitHub Action), ntfy alerts, Smart mode | REQUIRES CONFIGURATION | As before: fixture-tested, never run against the live internet. |
| CI running the tests | NOT IMPLEMENTED |  |
