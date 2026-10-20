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

**Charts.** `--chart` lists the categorical order: cyan, violet, green, gold, pink, blue. In Daylight the darker set is used. Never encode meaning with colour alone: bars have values in a tooltip and a "Show as a table" alternative.

## Type

Self-hosted (no runtime downloads): **Rajdhani** for headings and numbers, **IBM Plex Sans** for text, **IBM Plex Mono** for labels and data (`fonts/`, SIL Open Font License).

Scale (ratio 1.25): `--fs-12` · `--fs-14` · `--fs-16` · `--fs-20` · `--fs-25` · `--fs-31` · `--fs-39`. Body is 16 px. Numbers that change (timers, counts, money, stats) use `font-variant-numeric: tabular-nums` so they do not jump.

## Space, shape, elevation

- Space on a 4 px grid: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · `--s8` 32 · `--s10` 40 · `--s12` 48.
- Radius: `--r-sm` 6 (buttons, inputs, chips) · `--r-md` 10 (panels, cards) · `--r-lg` 16 (dialogs, hero) · `--r-full` (pills, dots).
- Elevation: `--e1` resting panel · `--e2` raised (menus, toasts, palette) · `--e3` dialogs.

## Motion

`--t-fast` 150 ms (hover, press) · `--t-med` 250 ms (page change, panels) · `--t-slow` 400 ms (large reveals). Easing `--ease`. With **prefers-reduced-motion** all three are 0 ms, ambient effects stop and the orb holds still; state is still shown by colour and text.

## Components (all in app.css / nova.css)

Panel (`.panel`, glass, `--r-md`, `--e1`, edge glow on hover) · Button (`.btn`, `.primary`, `.gold`, `.ghost`, `.danger`, `.danger-solid`, `.small`) · Field (`.field`, inputs, select, textarea) · Chip and tag · Stat tile (`.stat`) · List item (`.item`) · Empty state (`.empty`) · Error state (`.load-error`) · Toast · Dialog · Preview card (`.preview`) · Orb (`.nova-orb`, 11 states) · Chart (`.chart`).

## Rules

1. New colours, sizes, spacing or durations go into `design.css` first.
2. Never put meaning in colour alone; add text or an icon.
3. Every interactive element has a visible focus ring (`--cyan`, 2 px, offset 2 px).
4. Test both themes: `node scripts/snapshot-pages.js <dir>` and `npm test`.
