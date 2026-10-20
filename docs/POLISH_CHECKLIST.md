# Per-page polish checklist

Every NOVA page was checked against the same list. "Auto" means an automated test checks it on every `npm test` and in CI; "Seen" means it was looked at in the screenshots (`node scripts/snapshot-pages.js <dir> [--theme light]`).

## The list (applies to every page)

| # | Check | How it is verified |
|---|---|---|
| 1 | Clean at 390, 768, 1024 and 1440 px: nothing cut off, nothing off-screen, no sideways scroll | Auto: `tests/smoke-walk-e2e.test.js` (layout check) |
| 2 | Both themes readable; text contrast at least 4.5:1 | Auto: smoke walk in Deep Space (4 widths) and Daylight (390, 1440), axe-core `color-contrast` |
| 3 | No serious or critical accessibility issue | Auto: axe-core WCAG 2.1 AA on every page after its main interaction |
| 4 | No console errors, no failed requests | Auto: smoke walk |
| 5 | Loading state: skeleton lines with words | Auto: `tests/signature-e2e.test.js`, `tests/error-states-e2e.test.js` (slow server) |
| 6 | Error states: offline, 401, 429, 500 with a plain next step and Try again | Auto: `tests/error-states-e2e.test.js` (Dashboard, Chat, Smart Email, Knowledge Base, Life Tracker, Automation) |
| 7 | Empty state says what to do next | Seen; text in each page's empty message |
| 8 | Long text, Arabic (right-to-left), emoji, 200+ items | Auto: `tests/stress-e2e.test.js` |
| 9 | Keyboard: focus ring visible, logical Tab order, Escape closes, focus returns, focus kept after background refresh | Auto: `tests/nova-e2e.test.js` (keyboard only), `tests/race-e2e.test.js`, dialogs in `tests/nova-plus-e2e.test.js` |
| 10 | Reduced motion respected | Auto: `tests/signature-e2e.test.js` (tokens 0 ms, ambient still, orb still) |
| 11 | One shape language (radius tokens), one icon set, numbers in tabular figures | Seen; `DESIGN_SYSTEM.md` |

## Page notes (what was fixed in Phase 4)

| Page | Result | Fixed in this pass |
|---|---|---|
| Dashboard | pass | One greeting; headline in the hero (Phase 3) |
| Daily Briefing | pass | Day-load label not clipped at 390 px |
| NOVA Chat | pass | — |
| Voice Assistant | pass | "Start listening" was stretched to 70 px by the taller panel next to it: now a 48 px pill; push-to-talk choices centred and rounded |
| Smart Email | pass | Rounded message rows |
| Tasks and Calendar | pass | Rounded list rows |
| Focus and Planner | pass | — |
| Life Tracker | pass | Money panel moves under Reminders at 1180 px and wider (no empty gap); "When" hint no longer cut off ("6pm · in 20 min"); category amounts right-aligned so all bars are the same length |
| ProofLoop | pass | — |
| Weekly Insights | pass | — |
| Automation Centre | pass | Four jobs in two even rows (was three and one) |
| Personal Identity | pass | Switches rounded |
| Memory Vault | pass | — |
| Knowledge Base | pass | — |
| AI Usage and Cost | pass | — |
| Connected Apps | pass | Status chips rounded |
| Security and Settings | pass | Appearance (theme) panel |

Result of the automatic checks after this pass: 17 pages × 4 widths in Deep Space and 17 × 4 in Daylight, **0 problems** (layout, axe, console, requests).
