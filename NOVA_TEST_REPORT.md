# NOVA Test Report

Run: `npm test` on Node 22.22, Playwright 1.56 + Chromium, Linux sandbox. Result after Phase 1: **190 tests: 189 passed, 0 failed, 1 skipped** (about 200 seconds). Only tests that were executed are listed.

| Area | File | Tests | What it proves |
|---|---|---|---|
| NOVA server API | `tests/server-api.test.js` | 24 pass | anonymous access refused; private files never served; strict CSP and headers; dev login allow-list and loopback-only rule; CSRF and Origin checks; idle and absolute session expiry (fake clock), revoke, logout, allow-list removal; **cross-user isolation** for memories, chats, activity, export; Memory Vault CRUD with source and timestamps; secrets refused, sensitive confirmation; "remember" only proposes; "who am I" uses the account; personalisation off; **persistence across server restart** (file database); relevant-only retrieval (max 5); Claude adapter request shape (no tools, cached stable prompt) and usage/cost recording **with a stand-in client**; model failure and spending limit; honest "no model" reply; prompt-injection handling; input validation (bad JSON, type, size, 413); rate limiting; export and deletion; audit redaction; **Google sign-in against a stand-in Google** (PKCE, state, nonce, audience, expiry, allow-list, single-use state) |
| NOVA in the browser | `tests/nova-e2e.test.js` | 22 pass | sign-in gate under the strict CSP with **zero violations**; 13 pages (live vs Soon/Upcoming); orb states from real events and reduced motion; chat flow with approve/reject; Memory Vault UI incl. new browser (restart) and a second user; identity edits and personalisation; usage and security pages, real file download, session-ended handling; voice request reaching NOVA; layout at 1440/768/390 px (no overlap, no sideways scroll); keyboard-only chat; axe-core on login and 8 pages (no serious or critical issues) |
| Jarvis tools (unchanged) | earlier files | 144 pass, 1 skipped | calendar, .ics, collector, matching, Jobs for you, voice commands, Smart mode (mocked), layout, axe |

## Not tested (and why)

- **Real Google sign-in:** needs your Client ID and a person at the consent screen. Tested only against a stand-in.
- **Real Claude calls:** no API key (and nothing paid is being used). Tested only with an injected stand-in client.
- **Real microphone speech recognition**, accuracy, background noise, different speeds: no microphone in the sandbox. Voice-to-NOVA is tested through the typed command path only.
- **Real Gmail/Outlook, job boards, ntfy:** the sandbox blocks these hosts and they are not built (Gmail) or were fixture-tested earlier.
- **Load, penetration and long-running tests:** not performed.
- The 1 skipped test is the Jarvis live Google sign-in check (needs a Client ID).

## Defects found and fixed while testing (Phase 1)

1. Session endpoint required sign-in (it must be public) – fixed.
2. A screen re-fetched and re-rendered itself endlessly (it polled itself); redraws now happen only when data changed, ignoring volatile fields – fixed.
3. CSP blocked the Job finder's board requests – the allowed list now includes the job boards.
4. Oversized request bodies reset the connection instead of returning 413 – fixed.
5. Display name defaulted to a lowercase e-mail prefix – now capitalised.
6. Tab focus was lost after sending a chat message – focus returns to the message box.
7. Sign-in screen failed an accessibility rule at first run; top bar overflowed by a few pixels at 390 px – fixed.
8. Test helper evaluated mock scripts with `eval`, which strict CSP forbids – mocks are now plain init scripts.
