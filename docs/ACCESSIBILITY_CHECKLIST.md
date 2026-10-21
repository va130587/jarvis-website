# Accessibility: a 10-minute check with a real screen reader

**Status: UNVERIFIED on real assistive technology.** The automatic tests (axe-core with the WCAG 2.2 AA and "best-practice" rules on all 19 pages in both themes at 390 and 1280 px, the strictest 7:1 contrast check in high contrast, keyboard paths, focus checks and layout at 125% and 150% text) pass, but they cannot tell you how NOVA *sounds* in NVDA, JAWS or VoiceOver. Do this once, and tell Claude Code anything that is wrong ("fix this root cause and add a test that fails without the fix").

Use **NVDA** (free, Windows, with Chrome or Edge) or **VoiceOver** (built into Mac and iPhone, with Safari). Start NOVA (`npm run demo`), sign in with `demo@nova.local`. Turn the screen off or look away if you can.

| # | Do this | You should hear / see | Pass? |
|---|---|---|---|
| 1 | Reload the page and press **Tab** once. | "Skip to content" is read and appears on screen. | |
| 2 | Press **Enter** on it. | Focus moves into the page content; the menu is skipped. | |
| 3 | Press **Tab** a few times from the top. | You reach the menu links, then the page. Every stop has a name (no "button" or "link" alone). | |
| 4 | Open the menu item **Day Replay** with the keyboard. | You hear the page title ("Day Replay"), then "Day Replay page". Not twice in a way that is confusing. (If it is too chatty, tell Claude Code.) | |
| 5 | Go to **Dashboard**. Find the orb dots (**Tab**). | Each dot says what it is, for example "Submit the scholarship form, overdue 3 days". | |
| 6 | Go to **Weekly Insights** and Tab to a radar point. | You hear the measure and its number. **Show as a table** gives the same numbers. | |
| 7 | Go to **Chat**, type `add a task to call HR by friday`, send. | A preview is announced; its Effects row ("What happens if") is read; Approve and Reject have clear names. | |
| 8 | Open **Security and Settings**. Find **Contrast and text size**. | Two groups of radio buttons, each with a name; the chosen one says "checked". | |
| 9 | Choose **High contrast**, then **Larger (150%)**. | Text gets bigger and stronger. Nothing is cut off or hidden. Focus stays on the button you pressed. | |
| 10 | Press **Show the tour again** (Security and Settings). | A dialog opens and is announced; Next, Back and Skip are reachable; **Esc** closes it and focus returns. | |
| 11 | Open **Voice Assistant**. | The sentence about your browser is read ("Chrome can both listen and speak…"). **Test my microphone** shows a level that is also available as text ("Level 40%"). | |
| 12 | Open **Help** and press **Check my setup**. | Each result says OK, Needs attention or Not set up, in words. | |

**Notes to write down:** screen reader and version: ______   browser: ______   anything confusing: ______

What the automatic tests already prove: one `h1` and no skipped heading levels on every page; one `main` landmark; named navigation landmarks; a skip link on every page; focus on the page title after each page change with a polite announcement; no colour-only meaning; focus rings; 7:1 text contrast in high contrast; no sideways scrolling or overlap at 125% and 150% text from 390 to 1440 px.
