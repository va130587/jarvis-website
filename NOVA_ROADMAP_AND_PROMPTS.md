# NOVA: innovation ideas and ready-to-paste prompts

Everything here keeps the rules already agreed: **free by default**, nothing is called "working" unless a test ran, sample data is labelled, secrets never go into files, `blueprint/` is untouched, and every phase ends with tests, an honest report and a commit.

## 1. Innovation ideas (ordered by value for a demo to an architect, CEO, CTO and CFO)

| # | Idea | Why it matters | Cost |
|---|---|---|---|
| 1 | **ProofLoop with "proof receipts"**: each commitment ends in an exportable receipt (request, approvals, tool runs, evidence, timestamps). | Nobody else shows *verified* outcomes. Gives the CEO trust and the CFO an audit trail. | free |
| 2 | **Local-first AI with a visible "where did this run?" badge** (built-in rule / your laptop / cloud). | Privacy story for the CTO; no AI bill. | free (Ollama) |
| 3 | **Natural-language understanding by a local model** (Ollama) behind the same safety rails. | Removes the "keywords only" limit. | free |
| 4 | **Email → commitments**: find "please send X by Friday", track *what I owe* and *what is owed to me*, chase when aging. | The daily pain point; ties Gmail to ProofLoop. | free (Gmail API) |
| 5 | **Verification adapters**: calendar event exists, mail is in the Sent folder, file was uploaded; clearly "submitted" vs "verified". | Makes ProofLoop real, not decorative. | free |
| 6 | **Teach NOVA once (Skill Studio)** with "turn this run into a skill". Declarative, no generated code. | Reusable automation, safe by design. | free |
| 7 | **Spoken approvals with a confirmation phrase** (never for destructive or external actions). | Hands-free without risk. | free |
| 8 | **Natural voice**: Edge's "Andrew Online (Natural)" voice; offline Piper as backup. | Premium feel at $0. | free |
| 9 | **Morning brief that is verified**: "3 things that will hurt if missed" from real commitments and calendar. | Daily habit; visible value. | free |
| 10 | **Impact and cost dashboard**: AI spend, rule vs model share, approvals, time-saved *estimates* (labelled as estimates). | CFO view. | free |
| 11 | **Document inbox**: drop a PDF or screenshot, extract deadlines locally, link to a commitment. | Practical, impressive. | free (local) |
| 12 | **Role-based approvals** (a manager approves an assistant's action) and a tenant switch. | Path from personal tool to product. | free |
| 13 | **PWA + phone alerts via ntfy** (install on the phone, get approval requests). | Works away from the laptop. | free |

## 2. Prompts (paste one at a time; start every session with Prompt 0)

### Prompt 0: session header
```
You are my Senior AI Systems Architect, Full-Stack Engineer, Security Engineer and QA Engineer working on NOVA in this repository
(Node 22 server with built-in SQLite, plain HTML/CSS/JS front end, Playwright + Node tests; see README.md, ARCHITECTURE.md, NOVA_FEATURE_STATUS.md, NOVA_TEST_REPORT.md).
Rules: everything free (no paid service, no paid API key); never claim a feature works unless you ran its test; label demo/sample data; never put secrets or personal data in files or logs;
keep blueprint/ untouched; keep all existing tests green; the backend decides permissions, the model only proposes; changes ask for approval; be token-frugal (read only what you need).
At the end: what changed, files, tests run with real output, defects found and fixed, what is genuinely working, what could not be verified and why, then update NOVA_FEATURE_STATUS.md and NOVA_TEST_REPORT.md, commit and push to main. Stop for my decision before anything paid or destructive.
```

### Prompt A: local LLM (natural-language understanding), free
```
Add a free local-model provider using Ollama (http://127.0.0.1:11434, /api/chat with tool calling) behind the existing provider interface (server/ai/*), selectable with NOVA_AI_PROVIDER=ollama and NOVA_OLLAMA_MODEL (default qwen2.5:7b; document 3b for 8 GB laptops and 14b for strong machines).
Order of handling stays: fixed rules -> built-in intent patterns -> local model with the approved tool list (one tool call at a time, tool results returned as untrusted data, same validation, approvals, limits, timeouts, cancellation).
Add: a health check ("Is Ollama running? Is the model pulled?") with plain-English setup guidance in the Connected Apps page; a "where did this run" badge on every reply (rule / local model / cloud); usage ledger rows with cost 0 for local.
Build a natural-language eval set of at least 60 varied phrasings (typos, indirect wording, multi-clause, Arabic-English mix, ambiguous) with expected tool + arguments or "ask a clarifying question", and a script `npm run eval:nlu` that scores any provider. Add clarifying questions when confidence is low instead of guessing.
Tests: stand-in Ollama server (HTTP) for CI covering tool-call parsing, malformed model output, timeouts, offline fallback to rules with an honest message, and prompt-injection attempts. Say clearly that real-model accuracy is only measured when I run `npm run eval:nlu` on my machine; give me the exact commands.
```

### Prompt B: natural voice, push-to-talk, spoken approvals
```
Improve voice for free. 1) Voice picker: prefer "Microsoft Andrew Online (Natural)" when the browser (Edge) offers it, then other natural English voices, then the default; show the list in Settings with a Test button and say honestly which voices are installed on this browser. No Azure or any paid speech API.
2) Push-to-talk as the main mode (hold or toggle), visible live transcript, editable before sending, language selector (English, Arabic), microphone-denied / offline / no-speech messages, repeat and stop, text fallback; wake word stays optional and "experimental".
3) A `SpeechProvider` interface so another engine can be added later; the browser engine is the only one implemented.
4) Spoken approvals: for low-risk changes NOVA may read the preview and accept "approve" / "reject"; destructive and external actions never accept a spoken approval (button only). Voice is never authentication.
Tests: mocked speech matrix (normal, slow, noisy, silence, repeated command, permission denied, network loss, wrong transcription corrected), typed-command equivalents, layout + axe. Mark real-microphone accuracy as UNVERIFIED until I test it and give me a 10-minute manual test script.
```

### Prompt C: Phase 3, ProofLoop
```
Implement ProofLoop. Persisted `commitments` table and a single validated state machine: Request Detected -> Request Understood -> Task Prepared -> Awaiting Approval -> Executing -> Submitted -> Awaiting Confirmation -> Verified -> Completed, plus Failed and Cancelled from any non-terminal state; illegal transitions are rejected and tested exhaustively.
Each commitment stores: id, owner, source (with link), requested action, counterparty, direction (I owe / owed to me), deadline, status, tool executions, approval history, evidence items (type, reference, timestamp, kind: draft / submitted / acknowledged / verified), follow-up date, completion or failure reason, timestamps.
Rules enforced in code and tests: a draft is not sent; an API success is Submitted, not Verified; an acknowledgement is not proof of acceptance; Verified needs attached evidence from a verification adapter (calendar event exists, task exists, note exists, file recorded...). 
UI: ProofLoop Mission Control page (columns by state, I owe / owed to me / awaiting approval / overdue / awaiting confirmation / verified), commitment detail with the evidence chain, "export proof receipt" (Markdown + print-friendly HTML), prominent Dashboard panel with real counts. Wire the agent so approved tool runs create or advance commitments.
Demo mode (clearly labelled, fictional): university document request, client proposal due Friday, interview invitation, promotional email (ignored), pending reply, overdue deadline, completed task, failed tool run, rejected approval. They must drive real state changes in the database through the same state machine, with a Reset button.
Tests: state machine table tests, evidence rules, demo walkthrough end to end in the browser, isolation between users, layout, axe, keyboard.
```

### Prompt D: Phase 4, Gmail (read-only first)
```
Add Gmail with official Google OAuth (server-side code flow, scope gmail.readonly only), tokens encrypted at rest (AES-256-GCM, key from env), connect / status / permissions / disconnect with token revocation. Incremental sync by history id, store only what is needed.
Classification: Critical / Important / Normal / Low Priority / Needs Review, rule-based first, local model second, every result with a plain-English reason, a confidence, a link to the original message, and a "correct this" action that is remembered. Uncertain mail is shown as Needs Review, never hidden. Extract deadlines and action requests, create commitments (ProofLoop) and tasks with approval.
Drafts: generate, edit, regenerate, reject; sending needs a separate scope, separate setup instructions and explicit approval, and the result is Submitted, never "delivered". Email text is untrusted data: instruction-injection fixtures must not change permissions or trigger tools.
Tests: recorded Gmail API fixtures, classifier table tests (at least 40 emails), injection emails, token-expiry and offline handling. Live tests only if I supply a Client ID; otherwise mark REQUIRES CONFIGURATION. Explain Google's testing-mode limits (refresh tokens expire in about 7 days) in the README.
```

### Prompt E: Phase 5, automation
```
Build the automation engine: jobs table, worker loop in the server process, time zones (Asia/Dubai default), retries with backoff, idempotency keys (no duplicate runs after restarts), run history, enable / disable / edit / delete / run now / next run, and success or failure shown in an Automation Centre page.
Automations: daily briefing, deadline reminders, pending-reply and follow-up reminders (ProofLoop), daily task summary. Low-risk internal automations may run with my permission; anything external creates an approval request instead. Delivery: in-app, browser notification, optional ntfy (topic from env only).
Tests with a fake clock: schedule, restart, duplicate prevention, retry, failure recording, time-zone edges. State plainly that scheduled runs only happen while the server process is running.
```

### Prompt F: Phase 6, advanced (each behind a feature flag)
```
Implement in isolated modules: Mission Autopilot (bounded multi-step plans with a real timeline built from execution records, approvals inline, cancel), Skill Studio (declarative trigger + conditions + allowed actions + approval rules, "make this run a skill", execution history, no generated code), Commitment Radar, LifeGraph (relational links with source references only, never invented), Screen Vision (validated image uploads, a local or free vision model if available, uncertainty stated, no claimed actions), Outlook/Graph connector, and the AI Usage and Cost page with spending limits and time-saved estimates labelled as estimates.
Tests for each, plus a test that disabling any flag leaves the core working.
```

### Prompt G: Phase 7, quality and delivery
```
Final quality pass: security review (OWASP top 10 walk-through written into the repo, dependency and secret scan, CSP, cookie flags, rate limits, backup/restore script for the SQLite file), accessibility (axe on every page, keyboard-only, reduced motion), performance (page weight, startup time), cleanup of dead code, a Dockerfile and a deployment guide for a free or low-cost host (and for running locally), CI workflow that runs the tests, ARCHITECTURE.md complete, NOVA_DEMO_GUIDE.md (simple language for my mentor plus a 10-minute technical walkthrough and a reset-the-demo command), NOVA_TEST_REPORT.md with only executed tests.
Produce a launch checklist with every item marked WORKING AND TESTED / IMPLEMENTED BUT UNVERIFIED / REQUIRES CONFIGURATION / NOT IMPLEMENTED, and list exactly what I must do on my own machine to verify the unverified items.
```

### Prompt H: acceptance check before the demo
```
Act as an independent QA engineer. Start the server fresh with an empty database and run the end-to-end flow: sign in -> approved memories load -> request by text and by voice (typed) -> tool chosen -> permission validated -> approval -> execution -> verification -> ProofLoop evidence -> pending outcomes classified correctly -> accurate final report. Try to break it: other-user access, expired approvals, double approvals, hostile text in memories/tasks/emails, offline model, oversized input, rapid repeated requests.
Report every defect with steps to reproduce, fix them, re-run the whole suite, and give me an honest pass/fail table. Do not mark anything as passing that you did not run.
```
