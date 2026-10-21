# Improvement prompts

> **Status:** all ten prompts below were done in one combined job (Parts 1 to 10) and are in NOVA now: 1 guided tour, 2 Help and Check my setup, 3 export and import, 4 calendar-aware planner, 5 automatic backups, 6 livelier demo, 7 voice on more browsers, 8 speed and size guard, 9 accessibility, 10 Undo list. The prompts are kept as a record, and as a pattern for the next ones. See `NOVA_FEATURE_STATUS.md`, `NOVA_TEST_REPORT.md` and `docs/screenshots/after/improvements/`.

Copy one prompt at a time into Claude Code, opened in your project folder. Each is self-contained, keeps NOVA free and honest, and ends with a clear way for you to see the result. Do them in this order: the first two make NOVA easier to start and to trust; the rest add value.

Every prompt starts with the same rules block. Paste the block first, then the prompt.

## The rules block (paste this at the top of every prompt)

```
RULES (non-negotiable)
1. Free only: no paid APIs or services, no new runtime npm dependencies, no CDN scripts, no external fonts. Test-only devDependencies are allowed if you tell me.
2. Keep the strict Content-Security-Policy: no inline <script>, no eval, no inline event handlers.
3. Never break existing behaviour. `npm test` must be green after the work (run it 3 times at the end). Fix root causes. Never delete, skip or weaken a test. A new test must fail without the change and pass with it.
4. Security stays as is or gets stronger: sign-in, CSRF header, sessions, approvals before changes, read-only Gmail, no secrets in files or logs.
5. Honesty: anything that cannot be tested here (real Gmail, real microphone, real phone, real Google sign-in, a real Windows or Mac double-click) is marked UNVERIFIED with exact steps for me to check.
6. Do not touch blueprint/. Use the tokens in design.css; both themes (Deep Space and Daylight) and reduced motion must work.
7. Commit with a clear message, push to my working branch and main, check the GitHub Actions run and fix it if it fails.
DONE MEANS: zero console errors, no layout problems at 390/768/1024/1440 px, no serious axe issues in both themes, keyboard-only usable, plain empty/loading/error states, works with Arabic text, emoji and 200+ items.
REPORT: (a) what changed in 5 to 8 bullets in simple words, (b) the test result line, (c) 2 to 3 screenshots, (d) anything UNVERIFIED with exact steps, (e) exactly where I click to see it.
```

---

## 1. First-run guided tour (so a new person is never lost)

```
Add a first-run guided tour to NOVA. Today a new person sees 18 pages and no explanation.
- On the first sign-in (remember it per account in the database, not only in the browser), show a short tour of 6 steps: the orb, the left menu groups, Chat and approvals, the Promise Orbit, Ctrl+K search, and Security and Settings (themes). Each step highlights its area, says one plain sentence, and has Next, Back, Skip.
- Keyboard-only usable: focus moves into the tour, Escape skips it, focus returns to where it was. Screen-reader friendly (role="dialog", aria-live for the step text). Respect reduced motion.
- A "Show the tour again" button in Security and Settings.
- The tour never covers the control it explains, works at 390/768/1024/1440 px and in both themes.
- Tests: appears once for a new account, not again after Skip or Finish, can be restarted, keyboard path, layout and axe at four widths in both themes.
```

## 2. Plain-language errors and a "Something is wrong" help page

```
Add a Help page and make every error say what to do.
- New page "Help" (System group): how to start NOVA, what each page is for, the five most common problems with a fix each (port already in use, Node too old, Gmail not connecting, voice not working in Firefox, forgot which e-mail I used), and a "Check my setup" button.
- "Check my setup" calls a new read-only endpoint that returns plain-language checks: Node version, database writable, scheduler running, notifications possible, Gmail connected or not, AI model (rules or Ollama) reachable. Each check is OK, Needs attention (with the exact next step) or Not set up (and why that is fine).
- Review every API error message and every toast in the front end: none may show a code, a stack trace or a path; each says what happened and what to do next. Add a test that fails if an error message contains "undefined", "[object", "Error:" or a file path.
- Tests: the endpoint with each check failing, the page at four widths in both themes with axe, the message test.
```

## 3. Export and import (so your data is never trapped)

```
Make NOVA's data portable. Today there is "Download everything (JSON)" but no way to bring it back.
- Add "Import a NOVA export" in Security and Settings. It must show a preview first (counts of tasks, notes, memories, commitments, documents, habits, expenses) and ask for approval before changing anything, like every other change.
- Import into an empty account or merge without duplicates (skip items that already exist by a stable key). Never import sessions, tokens, secrets or other users' data. Validate size and shape strictly; refuse anything unknown with a plain message.
- Also add a human-readable export (a single Markdown file with tasks, notes, memories, commitments with their proof receipts) for people who just want to read their data.
- Tests: round trip (export, wipe, import = same data), merge without duplicates, refuses a tampered or oversized file, nothing imported without approval, another user's export cannot be imported into your account as theirs, layout and axe.
```

## 4. Calendar inside NOVA's planner (read-only first)

```
Let Focus and Planner see the calendar so it never plans over a meeting.
- Use the Classic calendar data that is already in this browser (ICS import and the Google/Outlook sync that exists today); send only the events for the planned day to the server in the plan request, never store them there. If no calendar is connected, the planner works exactly as now and says so.
- Events become fixed blocks in the day plan; tasks are planned around them; an event that clashes with a saved plan is flagged in the "What happens if" Effects row of any related approval.
- Everything stays read-only: NOVA never creates or edits calendar events from the planner.
- Tests with a fake calendar (events at the start, middle and end of the day; all-day events; an event overlapping lunch), layout and axe. Mark real Google/Outlook accounts UNVERIFIED with steps.
```

## 5. Backup that runs by itself, with a restore check

```
Make backups automatic and trustworthy.
- A scheduled job "Backup" (default 03:30 Dubai, daily, keep 14) in the Automation Centre using the existing backup code; show last backup, its size and its integrity result.
- A "Test my latest backup" button that restores it into a temporary database and reports counts, then deletes the temporary file; never touches the live database.
- A warning on the dashboard if no backup exists in 7 days.
- Tests with a fake clock: runs once a day, prunes to 14, a damaged backup is reported, the restore test leaves the live database unchanged. Document the one thing I must keep safe (NOVA_SECRET_KEY) in plain words.
```

## 6. Make the demo irresistible (for showing NOVA to others)

```
Improve the demo so the first minute impresses.
- The demo data should look alive: events spread across the last 14 days and across the hours of each day (so Day Replay and the Life Radar have real shapes), a completed ProofLoop commitment with a verified receipt, a spending month with a budget near 80%, two habits with different streaks.
- Add a "Guided demo" banner on the dashboard in demo mode with 5 numbered steps linking to the right pages (Promise Orbit, Day Replay, Life Radar, a receipt check, an Effects preview) and tick each when done.
- Keep everything labelled fictional.
- Tests: the demo seed is idempotent, dates are relative to today (the suite must pass at any time of day), the banner works by keyboard, layout and axe in both themes.
```

## 7. Voice that works on more browsers

```
Improve voice without paid services.
- Detect the browser and say exactly what works: Chrome/Edge full speech in and out; Safari partial; Firefox no recognition (typing and speech out only). Show this on the Voice page in one plain sentence, with the fix.
- Add a push-to-talk fallback for browsers without recognition: a big "Type or paste" box that sends exactly like speech, with the same approval rules (a typed "approve" is not accepted for risky changes).
- Add a 10-second microphone self-test (level meter, no recording stored) so I can see whether the microphone is being heard.
- Tests with the mock speech engine for each browser profile. Real microphones are UNVERIFIED: give me exact steps.
```

## 8. Speed and size check in CI

```
Add a performance guard so NOVA never gets slow without us noticing.
- A CI step that fails if: first content takes over 1 s, layout shift exceeds 0.1, any task blocks over 100 ms, the total size of files served for the first page exceeds a budget (measure it now and set the budget 15% above), or a new file larger than 200 KB is added outside docs/ and fonts/.
- Compress what the server sends (gzip for text files, with correct Vary and Cache headers; ETag so unchanged files return 304) using only Node's built-in zlib. Never cache /api/ or /auth/.
- Tests: compressed and plain responses are identical after decoding, 304 works, API responses are never cached, the budget test fails when I add a large file on purpose.
```

## 9. Accessibility pass with real assistive-technology checks

```
Go beyond automated checks.
- Add a visible "Skip to content" that works on every page, landmarks on every page, a logical heading order (one h1 per page, no skipped levels), and focus that moves to the page title after each page change (announced politely).
- Add a high-contrast option and a "larger text" option (125%, 150%) in Security and Settings next to the theme, remembered like the theme; layouts must not break at 150% text on 390 px.
- Add tests: heading order on all pages, focus after navigation, the contrast and text options at four widths, axe with the "best-practice" tags too.
- Real screen readers (NVDA, VoiceOver) are UNVERIFIED: give me a 10-minute checklist to run myself.
```

## 10. A safer "undo" for everything NOVA does

```
Make Undo easy to find and never surprising.
- An "Undo" list: the last 20 changes NOVA made (from run history), each with what changed, when, and an Undo button where undo is possible, or a plain reason where it is not (for example, deleted memories). Put it under Day Replay and in the bell menu.
- Undo goes through the same preview and approval as any change, and says what else it affects (extend the Effects row).
- Tests: undo each reversible tool, the refusal reasons, double-click safety, another user's changes never listed, layout and axe.
```

---

## After any prompt

1. Run `npm run demo` (or double-click `Start NOVA demo.bat` / `Start NOVA demo.command`) and follow the "where I click" line in the report.
2. If something looks wrong, send the screenshot and the words on the screen to Claude Code and say: "Fix this root cause and add a test that fails without the fix."
