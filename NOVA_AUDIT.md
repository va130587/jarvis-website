# NOVA Audit

Session 1 audit of the repository as it stands on `main` (commit `82055fa`). No feature code was written in this session. Every statement below was read from the code or from a test run; anything not verified is marked **(unverified)**.

## 1. What the repository is today

The repository is **Jarvis**, a personal assistant for one person (Roshan, a fresher in the UAE). It is a **static website**: plain HTML, CSS and JavaScript, no build step, no backend, no database, no user accounts. It is published on GitHub Pages. It is not yet NOVA, and it has no Claude or any other cloud AI integration (the optional on-device "Smart mode" is a separate, off-by-default feature that has only been tested with mocks).

### Architecture found

```
Browser (the whole product)
  index.html  + app.css                      shell, design tokens, nav, dialogs
  core.js      (548 lines)  window.J         data model, Dubai dates, text parsing, persistence (localStorage key "jarvis.v3")
  app.js       (842)                          router, screens: Today, Tasks, Notes, Growth, Review, Profile, Settings, Help
  jobs.js      (539)                          Job finder, applications tracker, loads data/jobs.json, live fallback fetch
  match.js     (382)  UMD (browser + Node)    rule-based, explainable job-matching engine
  matches.js   (572)                          "Jobs for you" dashboard, rules/alerts, digest, application pack, job voice commands
  calendar.js  (1174)                         Google Calendar (GIS token client + REST), Outlook (MSAL + Graph), .ics
  ics.js       (334)  UMD                     .ics read/write
  voice.js     (764)                          Web Speech recognition + synthesis, orb canvas, chat panel, command router
  smart.js     (129)                          optional on-device AI (Chrome built-in AI / WebLLM), suggest-only
GitHub Actions (server-side, scheduled)
  .github/workflows/collect-jobs.yml          every 6 h: scripts/collect-jobs.js -> data/jobs.json, data/SOURCES.md
  scripts/collect-jobs.js, check-links.js     dependency-free Node 22
Tests (Node test runner + Playwright, 144 tests)
  tests/*.test.js, tests/helpers.js           static server, mocks for Google GIS/Calendar, MSAL/Graph, speech, Notification
Other: blueprint/ (untouched presentation), vendor/msal-browser-4.30.0.min.js, README.md
```

Stack: vanilla JS in IIFEs sharing one global `window.J`; HTML built with string concatenation and a shared `esc()` helper; CSS custom properties (navy/cyan/gold HUD theme); Playwright 1.56 and axe-core as dev dependencies only.

### Data model (all in `localStorage["jarvis.v3"]`)
`profile`, `tasks`, `notes`, `skills`, `wins`, `apps` (applications with checklist and `prep` pack), `people`, `settings`, `cal` (calendar connection state and synced events), `rules`, `alerts*`, `reports`, plus job cache in memory. One user, one browser.

## 2. Current working features (all covered by passing tests: 143 pass, 1 skipped, 0 fail)

| Area | What works | Main files | Evidence |
|---|---|---|---|
| Tasks, notes, growth, weekly review | CRUD, plain-English capture ("call HR tomorrow at 10am"), Dubai time, UAE weekend, undo | `core.js`, `app.js` | layout tests, voice tests (indirect) |
| Voice assistant | Push-to-talk and wake word via Web Speech, spoken replies, chat panel, ~60 commands | `voice.js` | typed-command tests; microphone itself **(unverified)**, no headless mic |
| Calendar | Google (read / two-way, confirmation before writes), Outlook, .ics import/export, clashes, free time | `calendar.js`, `ics.js` | `calendar-*.test.js`, `ics.test.js` with mocked Google/Microsoft |
| Job collection | 57 candidate sources, normalise, dedupe, scam flags, archive, ntfy message | `scripts/collect-jobs.js` | `collector.test.js` with fixtures |
| Job matching | 0-100 score with six parts, verdicts, gaps, learning links, CV keywords, interview questions | `match.js` | 54 tests, 45 sample descriptions |
| Jobs for you | Tabs, filters, Why panel, rules/alerts, application pack, digest, weekly report, profile onboarding, voice commands | `matches.js`, `jobs.js` | `jobs-e2e`, `jobs-voice`, `jobs-layout` |
| Smart mode | Consent, progress, suggest-only, fallbacks | `smart.js` | `smart.test.js` with **mocked** models only |
| Accessibility / layout | 1440/768/390 px, keyboard-only, axe-core no serious issues on 6 screens | tests | executed |

## 3. Broken or incomplete

1. **The collector has never run against the real internet.** All 57 sources are unverified candidates; `data/jobs.json` is empty. (Sandbox blocks the hosts.)
2. **Smart mode and the WebLLM CDN version (0.2.79) are unverified** against real Chrome built-in AI / WebGPU.
3. **Learning links** are format-checked only; `scripts/check-links.js` has not run live.
4. **The microphone path has never been exercised in a real browser** by the test suite (speech is mocked); accuracy, noise, permission-denied and network-loss behaviour are untested.
5. **Live Google/Microsoft sign-in is untested**; the live-Google test is skipped without a Client ID.
6. Whether GitHub Pages republishes after the Action's bot commit is unverified.
7. README states tokens are "never saved to disk"; the Google token is kept in `sessionStorage` and the MSAL cache is set to `localStorage` (calendar.js:209). Wording should be corrected and the storage choice reviewed.
8. No CI: `npm test` is not run by any GitHub workflow.

## 4. Missing versus the NOVA specification

Everything that makes NOVA more than Jarvis is absent:

- Backend, database, API, secret management, scheduler/worker (needed for anything that must run with the browser closed other than the existing GitHub Action).
- Authentication and identity (Google sign-in, sessions, per-user records, authorisation checks).
- Server-side persistent memory with sources, correction, deletion, relevant-only retrieval.
- Claude integration (agent loop, tool registry, approvals, structured tool calling, usage accounting).
- Gmail connector (none; only Calendar exists), classification, deadline extraction, reply drafts.
- ProofLoop (commitments, state machine, evidence, owes-me/I-owe). The closest thing today is the `apps` tracker (Saved → Applied → …), which is a manual pipeline with no evidence or verification.
- Mission Autopilot, Skill Studio, Commitment Radar, LifeGraph, Screen Vision, Future Preview / Action Guardian, cost monitor, audit log, demo mode, the NOVA orb (10 states; voice.js has a canvas orb with 4 states), the 13-page NOVA navigation and the NOVA brand.

## 5. Security weaknesses

| # | Finding | Severity | Where |
|---|---|---|---|
| S1 | **No authentication.** Anyone with the browser profile (or an XSS) is the "owner". | High for NOVA | whole app |
| S2 | **All personal data in plaintext `localStorage`** (tasks, notes, profile, applications, synced calendar events). Readable by any script on the origin; lost on clearing site data; no multi-device. | High | `core.js:9`, `:376` |
| S3 | **OAuth tokens in browser storage:** Google access token in `sessionStorage` (`jarvis.gtoken`), MSAL cache in `localStorage`. An XSS would exfiltrate them. Gmail scopes would make this materially worse. | High for Gmail | `calendar.js:94,116,209` |
| S4 | **No Content-Security-Policy** (`grep` finds none in `index.html`). | Medium | `index.html` |
| S5 | **HTML is built by string concatenation** (about 256 `esc()` call sites). Safe only while every dynamic value is escaped. Third-party job text and (in future) email text flow into it. No test injects hostile payloads **(unverified: not tested)**. | Medium, High once email arrives | `app.js`, `matches.js`, `jobs.js` |
| S6 | WebLLM is `import()`ed from jsDelivr with a pinned version but **no integrity check** (dynamic import cannot use SRI). Opt-in only. | Low-Medium | `smart.js:11` |
| S7 | No rate limiting, audit log, or data-retention controls (no server to hold them). | n/a until backend | - |
| S8 | Public repository: `data/jobs.json`, sources and workflow are public by design. A test verifies no profile data or secrets are committed. ntfy topic is kept in a repo secret/variable. | Low (by design) | `tests/collector.test.js` |
| S9 | Prompt-injection surface does not exist yet; it will as soon as email text reaches Claude. Needs a design (see plan P2/P4). | Future | - |

Positive findings: no secrets in the repository; Calendar writes already require a confirmation step; no `eval`/`document.write` in app code (`innerHTML` used 6 times, all with escaped content on inspection **(partially verified)**).

## 6. Code-quality concerns

- Global-namespace IIFEs (`window.J`) with implicit load order; no modules, no types, no linter, no formatter.
- Large files (`calendar.js` 1174 lines, `app.js` 842, `voice.js` 764) mixing UI, state and logic; intent parsing is regex-based and spread across `voice.js`, `matches.js`, `calendar.js`.
- String-built HTML makes escaping a per-line discipline rather than a guarantee.
- State and business logic live in the browser, so there is no server-side authority to enforce permissions (required for NOVA).
- Good: strong test culture (144 tests), deterministic time mocking, clean separation of `match.js`/`ics.js` as UMD modules that Node can run, collector with injectable I/O.

## 7. Recommended improvements and priorities

| Priority | Item | Why |
|---|---|---|
| 0 | Decide backend, hosting and Claude API spending (see plan, section 3) | Gates everything |
| 1 | Add a Node backend that serves the existing front end, with Google sign-in, server sessions, SQLite, per-user rows | Fixes S1, S2, S3 and enables the rest |
| 2 | CSP + hostile-payload escaping tests; CI workflow running `npm test` | Cheap, high value |
| 3 | Memory Vault + model-agnostic AI layer + tool registry + approvals + activity log | Core of the NOVA agent |
| 4 | ProofLoop state machine and demo scenarios | The signature feature; testable offline with fixtures |
| 5 | Gmail read-only, classification, deadline extraction, drafts | Real value; needs live Google config |
| 6 | Scheduler, push-to-talk hardening, cost monitor | Reliability and CFO story |
| 7 | Advanced features, polish, docs, mentor demo | Last, isolated |

Reuse rather than rebuild: `match.js` patterns (explainable rules) become the deterministic email classifier; `voice.js` recognition/synthesis becomes a `SpeechProvider`; `calendar.js` REST clients move server-side one connector at a time; the Playwright harness and `helpers.js` mocks are extended; the design tokens in `app.css` are extended for the NOVA palette.
