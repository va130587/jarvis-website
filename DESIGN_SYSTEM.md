# NOVA design system

All visual decisions live in **`design.css`** as CSS custom properties. `app.css` and `nova.css` contain components only and use the tokens; they should not contain raw colours, font sizes, spacing or durations except for one-off art (the orb, the sky banner, SVG data URIs).

## Themes

| Theme | How it is chosen | Notes |
|---|---|---|
| **Deep Space** (default) | always, unless Daylight is chosen | dark navy gradient `#03060D → #071226`, glass panels |
| **Daylight** | Security and Settings → Appearance; remembered in this browser (`localStorage` key `nova.theme`) | applied by `boot.js` before the first paint, so there is no flash |

The theme is set as `data-theme="light"` on `<html>`. Every component reads tokens, so it only changes token values.

## Colour

| Token | Deep Space | Daylight | Use |
|---|---|---|---|
| `--bg-top` / `--bg-bottom` | `#03060D` / `#071226` | `#F5F8FC` / `#E6EDF6` | page background gradient |
| `--glass` | `rgb(10 22 42 / .72)` + `blur(14px)` | `rgb(255 255 255 / .78)` | panels |
| `--edge` / `--edge-hi` | `rgb(120 200 255 / .18)` / `.45` | `rgb(20 70 120 / .16)` / `.38` | panel and control borders |
| `--cyan` | `#4FD8FF` | `#00679A` | primary accent, focus ring, links |
| `--violet` | `#9B7BFF` | `#5B3FC4` | AI / planning / focus |
| `--ok` | `#5BE3A4` | `#0B7A4F` | success, verified |
| `--warn` | `#F5C46A` | `#8A5A00` | waiting for approval, warnings, key numbers |
| `--danger` | `#FF6B6B` | `#B3261E` | errors, destructive actions |
| `--text` | `#E8F3FF` | `#0B1A2E` | body text |
| `--text-2` | `#A3B8D0` | `#3E5470` | secondary text |
| `--text-3` | `#8AA0BA` | `#4F6582` | labels and hints |

Each accent also has an `-ink` variant for text on a tinted background (`--danger-ink`, …) and an `-rgb` triple for transparency: `rgb(var(--cyan-rgb) / .12)`.

**Contrast.** All text tokens meet WCAG AA (4.5:1) on both the background and the glass panels in their theme; this is checked on every page at four widths by axe-core in `tests/smoke-walk-e2e.test.js` (both themes).

**Charts.** NOVA's charts are single-series (tasks per day, focus per day, spending by category with names beside the bars), so they use one hue: `--cyan`. Values and labels use text colours, never the series colour. For a future chart with several series, `--chart` holds a categorical order that passed a colour-blind check (OKLCH lightness band, chroma floor, CVD separation between neighbours, normal-vision floor, 3:1 contrast): Deep Space `#1E9FCF #D95926 #9085E9 #199E70 #C98500 #D55181`, Daylight `#0B7FB0 #EB6834 #6250D6 #1BAF7A #EDA100 #E87BA4` (in Daylight three slots are under 3:1 on white, so such a chart must show direct labels or its table view). Never encode meaning with colour alone: bars have values in a tooltip and a "Show as a table" alternative.

## Type

Self-hosted (no runtime downloads): **Rajdhani** for headings and numbers, **IBM Plex Sans** for text, **IBM Plex Mono** for labels and data (`fonts/`, SIL Open Font License).

Scale (ratio 1.25): `--fs-12` · `--fs-14` · `--fs-16` · `--fs-20` · `--fs-25` · `--fs-31` · `--fs-39`. Body is 16 px. Numbers that change (timers, counts, money, stats) use `font-variant-numeric: tabular-nums` so they do not jump.

## Space, shape, elevation

- Space on a 4 px grid: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · `--s8` 32 · `--s10` 40 · `--s12` 48.
- Radius: `--r-sm` 6 (buttons, inputs, chips) · `--r-md` 10 (panels, cards) · `--r-lg` 16 (dialogs, hero) · `--r-full` (pills, dots).
- Elevation: `--e1` resting panel · `--e2` raised (menus, toasts, palette) · `--e3` dialogs.

## Motion

`--t-fast` 150 ms (hover, press) · `--t-med` 250 ms (page change, panels) · `--t-slow` 400 ms (large reveals). Easing `--ease`. With **prefers-reduced-motion** all three are 0 ms, ambient effects stop and the orb holds still; state is still shown by colour and text.

## Signature details

- **Orb**: 11 states (idle, listening, transcribing, understanding, planning, executing, waiting for approval, speaking, completed, error, focusing), each with its own colours, motion and words; colours glide between states (`@property --c1/--c2`, `--t-slow`).
- **Ambient background**: a faint grid and two slow light fields (`.fx-aurora`, 40 s). It pauses when the tab is hidden and does not move with reduced motion.
- **Page change**: content fades up in 180 ms with at most 60 ms stagger (under 250 ms in total).
- **Count-ups**: whole-number stat tiles count up in 400 ms when a page opens and always end on the real number.
- **Loading**: skeleton lines with the words "Loading…" kept for screen readers (`role="status"`).
- **Navigation**: sidebar groups Today · Work · Life · Knowledge · System; on phones a bottom bar with Home, Today, Chat, Tasks and More.
- **Icons**: one set, 24 px grid, 1.6 px round strokes, `currentColor`.

## Newest components

- **Promise Orbit** (`.orbit`, `.odot`): dots on the dashboard orb. State is shape + colour + words: overdue = red ring with "!", waiting = dashed amber ring, verified = green ring with a tick, open = cyan ring. Turns one small step a second (`steps(240)`), pauses on hover/focus, when the tab is hidden and with reduced motion.
- **Day Replay** (`.rp-*`): an hourly activity strip, a range slider with a marker, and a list of events; rows later than the marker use a dashed edge and the secondary text colour (never lower contrast than AA).
- **Life Radar** (`.rd-*`): `--chart-1` (this week, solid line, filled) and `--chart-2` (last week, dashed, hollow points), chosen with the colour-blind check; text in text tokens; every spoke focusable.
- **Receipt check** (`verify.css`): the same tokens on a standalone page.
- **Effects** (`.preview .fx`): a row in the Future Preview card.
- Tokens added: `--chart-1` to `--chart-6` (the categorical order, one per variable).

## Display options (accessibility)

- **Larger text:** `html[data-text="125"]` and `[data-text="150"]` redefine the seven `--fs-*` tokens (12 to 39 px) at 125% and 150%. Because every size is a token, the whole page follows; grid columns that held a time or a label use `calc(var(--fs-14) * n)` so they grow too. Rows (`.item`, `.sources li`) wrap under these options.
- **High contrast:** `html[data-contrast="high"]` sets pure white (Deep Space) or black (Daylight) text, near-solid panels, full-strength edges, brighter or darker accents, a 3 px focus ring, and turns the ambient effects off. Text reaches 7:1 (checked by axe `color-contrast-enhanced` on every page in both themes).
- Both are chosen in Security and Settings next to the theme, remembered in `localStorage` (`nova.contrast`, `nova.text`) and applied by `boot.js` before the first paint. They combine with either theme.
- New components: the tour (`.tour-*`), import preview (`.imp-*`), backups (`.bk-*`), undo list (`.un-*`), mic meter (`.mic-*`), guided demo (`.demo-*`), help (`.hp-*`). All use the tokens.

## Components (all in app.css / nova.css)

Panel (`.panel`, glass, `--r-md`, `--e1`, edge glow on hover) · Button (`.btn`, `.primary`, `.gold`, `.ghost`, `.danger`, `.danger-solid`, `.small`) · Field (`.field`, inputs, select, textarea) · Chip and tag · Stat tile (`.stat`) · List item (`.item`) · Empty state (`.empty`) · Error state (`.load-error`) · Toast · Dialog · Preview card (`.preview`) · Orb (`.nova-orb`, 11 states) · Chart (`.chart`).

## Rules

1. New colours, sizes, spacing or durations go into `design.css` first.
2. Never put meaning in colour alone; add text or an icon.
3. Every interactive element has a visible focus ring (`--cyan`, 2 px, offset 2 px).
4. Test both themes: `node scripts/snapshot-pages.js <dir>` and `npm test`.
