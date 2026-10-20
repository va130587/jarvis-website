# Phase 0 baseline (before the hardening and redesign)

Taken on 20 October 2026, commit ef08b08, on the demo data (`npm run demo`). Screenshots of all 17 pages at 390, 768 and 1440 px are in `docs/screenshots/before/`; `report.json` there holds the automatic checks for 390 / 768 / 1024 / 1440 px (made with `node scripts/snapshot-pages.js docs/screenshots/before`).

## Test runs (`npm test`, three times in a row)

| Run | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 1 (before midnight in Dubai) | 332 | 331 | 0 | 1 |
| 2 (after midnight) | 332 | 328 | 3 | 1 |
| 3 | 332 | 329 | 2 | 1 |

The suite was **not stable**: the same code failed after midnight Dubai time.

## Problems found

### Functional
1. **Date-dependent demo e-mails.** The demo inbox contains fixed dates ("due by 2026-10-28") and weekday words ("before Friday"), so what the demo shows, and the tests that check it, change with the calendar (Smart Email counts, the acceptance walk-through).
2. **"By tomorrow" read after midnight.** A message received at 22:30 that says "by tomorrow" is due *today* after midnight; tests assumed "tomorrow".
3. **Stale briefing on first view.** A page shows its cached data first and refreshes a moment later; a test (and a person) could see an old briefing without the new e-mail section.
4. **Tasks page cannot act on NOVA tasks.** Completing or deleting a task means going to Chat; there are no buttons.
5. **Old classic reminder on every load.** The sample browser data ("Update CV with the data project") announces a reminder at every start in server mode.
6. **Outdated text.** Tasks and Calendar still says Gmail is "upcoming".
7. **Error states.** When a page's first load fails (offline, 429, 500), it can stay on "Loading…" with only a short message.

### Visual and layout
8. **Knowledge Base at 1024 px:** the side column ("Add a document", the file picker, the document list) overflows off-screen.
9. **Floating voice orb covers content** near the bottom on several pages (Chat hint text at 390 px, Smart Email).
10. **Background seam:** the grid texture ends in a visible horizontal line partway down long pages.
11. **Dashboard at 390 px:** the "Replies from a model" tile text is cut off; labels wrap awkwardly in the 2x2 stat tiles.
12. **Sidebar** runs past the bottom of the window at 900 px height without a visible cue.
13. **External fonts:** fonts load from Google Fonts at runtime (against the free/self-hosted rule); accessibility tools warn that the external stylesheet cannot be read ("Couldn't load preload assets" on every page).
14. **Inconsistent styling:** many one-off styles and several different panel, tile and list looks; no single design-token file; no light theme.
15. **Dense text panels** (Dashboard "What works today") instead of a clear hierarchy.

### Checks that were already clean
- No serious or critical accessibility (axe) issues on any of the 17 pages at four widths.
- No failed API requests on any page.
- Layout check clean everywhere except problem 8.
