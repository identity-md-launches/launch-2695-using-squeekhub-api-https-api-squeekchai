# SPM design system

## Overview

SPM is a friendly prediction tool: the vote comes first, followed by evidence and public scores. Warm paper surfaces, forest-green actions and a small illustrated hamster wheel connect the product to Squeektoshi without a separate marketing hero. The main action remains on the first 390px-wide screen. The illustration is decorative; measurements, source status and points are always HTML text.

The canonical implementation is `src/styles.css`, with page composition in `src/App.tsx` and reusable controls in `src/components/`. The final export was viewed at 390 and 1440 wide; automated Chromium/WebKit checks also cover 320 and 768. The site has one intentionally light theme and English copy.

## Colors

Source: the two-level primitive/semantic tokens in `src/styles.css:8`.

| Role | Token/value | Use |
| --- | --- | --- |
| Page | `--color-bg` → `--neutral-50` `#f7f8f2` | Warm background |
| Surface | `--color-surface` → `--neutral-0` `#fffefa` | Panels, dialogs, inputs |
| Primary text | `--color-text` → `--neutral-900` `#28342a` | Headings, body and values |
| Secondary text | `--color-muted` → `--neutral-600` `#626b5d` | Labels, explanations and units |
| Separation | `--color-border` → `--neutral-200` `#dfe3d7` | Structural panel/control borders |
| Neutral state | `--neutral-100` `#eff1e9` | Disabled controls and loading shapes |
| Control edge | `--neutral-300` `#a3ac9c` | Resting radio indicators and field edges |
| Main action | `--color-accent` → `--green-800` `#254d38` | Primary action, selected radio mark |
| Action hover | `--color-accent-hover` → `--green-900` `#1c3d2b` | Hovering primary control |
| Selection | `--color-selected` → `--green-50` `#edf2e6` | Selected side, active prediction |
| Green support | `--green-100` `#e1e9d5`; `--green-600` `#527148` | Text selection/avatar tint; complete chart bars and online dot |
| Focus | `--color-focus` `#526baf` | 2px outline, 4px offset |
| Waiting/Under | `--amber-50` `#f6ede3`; `--amber-700` `#92542f` | Category icon and collecting-history text |
| Error | `--color-error` → `--red-700` `#a03e36` | Inline recoverable errors |
| Illustration surface | `#eaf0df` | Wheel panel; its `#ced8c0` separators stay local to that panel |

Source chart hatching uses `#e2e7d8`, `#c6d0b9`, `#a1af92` and the legend’s matching `#d6dec9`/`#839673`. It marks incomplete evidence, never a zero-distance day. Decorative SVG colors live in `Wheel.tsx`; official wallet marks retain their original colors. These are not extra action colors or theme ramps.

Measured rendered pairs: primary text/page **12.18:1**, secondary text/surface **5.50:1**, waiting text/surface **5.89:1**, primary button text/fill **9.47:1**, and secondary text/wheel panel **4.77:1**. These are observations for the named default-state pairs, not a claim about every possible asset/background. The final probe passed its contrast check.

## Typography

DM Sans is a locally bundled Latin variable WOFF2 at `src/assets/dm-sans-latin.woff2`, with Arial/sans-serif fallbacks and `font-display: swap`. Its 100–1000 weight range loaded in the browser; the UI uses only **400, 500 and 600**. The retained font license is `src/assets/OFL.txt`.

| Token | Size at 16px root | Role |
| --- | ---: | --- |
| `--text-sm` | 14px | Captions, navigation, helper copy, data rows |
| `--text-base` | 16px | Body, primary controls, fields |
| `--text-lg` | 20px | Section headings, side choices |
| `--text-xl` | 24px | Secondary values, desktop wordmark, dialog titles |
| `--text-2xl` | 32px | Compact heading and baseline denominator |
| `--text-display` | 48px | Desktop headline and primary metric |

Body line height is 1.5; headline 1.1; section headings 1.3. Long helpers use 1.5–1.6. Display tracking is −0.055em and section headings −0.025em; prose uses natural tracking. Unit text explicitly resets inherited tracking. Headings balance wrapping, short descriptions use pretty wrapping, and numeric values use tabular figures. Full addresses wrap when disclosed; short addresses are navigation aids, with complete values reachable in the wallet sheet or row disclosure. Inputs remain 16px on phones.

## Layout

The header and main shell have a maximum outer width of **1244px**, including **32px** horizontal padding, producing a **1180px** desktop content area. Main top padding is 42px. Spacing mostly uses 4/8/12/16/20/24/28/32px steps. Desktop panel interiors are 24–32px; phone interiors are 18–24px.

The top and bottom grids share columns and edges: **1.6fr/1fr** with 24px gaps. The prediction panel precedes the wheel in DOM and visual order. History then precedes the leaderboard. The explanatory strip stays below the product.

| Breakpoint | Implemented behavior |
| --- | --- |
| ≤1120px | Grid ratio 1.45/1; 20px gap; compact panel padding |
| ≤900px | Header navigation hides; heading becomes 32px; grid ratio 1.25/1; wheel details stack |
| ≤700px | One column; 20px outer padding; three explanatory steps stack |
| ≤640px | Native dialogs become full-width bottom sheets with safe-area padding |
| ≤430px | 16px outer padding; 32px heading; compact header; vote options remain side by side |
| ≤355px | Brand caption hides; option icon/text stack; wheel values stack to preserve readability |

Widths use `minmax(0, …)` and flexible text rows. Cards grow vertically; no critical text is clipped. At the actual 390×844 view the main prediction button occupies approximately y=617–665. There is no sticky control covering content. Browser checks observed no horizontal overflow at 320, 390, 768 or 1440. Native browser zoom and translated layouts were not manually certified.

## Elevation & depth

Main surfaces are flat: a 1px structural border and no shadow. The wheel uses a contrasting background without an outer border. Only the modal is elevated, with `0 24px 80px #1e302c30`; it has no border. Its backdrop uses `#182b2366` and a 3px blur. The browser’s native modal top layer keeps background content inert and focus inside. There are no nested decorative cards or gradient text.

## Shapes

`--radius-sm: 8px` for buttons/fields, `--radius-md: 12px` for prediction choices, and `--radius-lg: 20px` for outer panels/dialogs. Bottom sheets round only their top corners. Radio indicators, status dots and compact avatars use circles. Chart columns round only the top edge. SVG artwork has its own physical geometry and does not define UI shape rules.

## Components

| Component/pattern | Source | States and reuse |
| --- | --- | --- |
| `Icon` | `src/components/Icon.tsx` | One 24px-viewBox set; currentColor and 1.7px strokes; decorative SVGs hidden from accessibility tree |
| `Modal` | `src/components/Modal.tsx` | Native `dialog`; title/close control, backdrop/Escape dismissal, body scroll lock, focus restoration; centered desktop and bottom sheet ≤640px |
| `ConnectSheet` | `src/components/ConnectSheet.tsx` | Named EIP-6963 extensions, generic fallback when needed, official local marks, phone links, Coinbase, row pending/disabled/error states; connected wallet details and disconnect |
| `.primary`, `.secondary`, `.text-button`, `.icon-button` | `src/styles.css` | One filled main action per panel; clear hover, press and keyboard focus; primary minimum 48px, secondary 44px, icon 40px; disabled controls explain why nearby |
| Prediction options | `src/App.tsx`, `.prediction-option` | Native labelled radio group, arrow-key behavior, visible selected check, 12px spacing, 2px focus ring on containing label |
| `ActivePrediction` | `src/App.tsx` | Frozen side/target, countdown, due time and awaiting-evidence copy; no editable choice while pending |
| `HistoryChart` | `src/App.tsx` | Solid complete bars, hatched incomplete bars, explicit unavailable state, chart description and native disclosure containing daily values |
| `LeaderboardRows` / `FullLeaderboard` | `src/App.tsx` | Shared data, points and ranks; accessible full-address disclosure; distinct loading/error/empty/unconfigured states and bounded pagination |
| `ServiceSettings` | `src/App.tsx` | Labelled URL field, inline validation, pending check and save; validates an actual compatible service before accepting it |
| `Wheel` | `src/components/Wheel.tsx` | Decorative local SVG; live distance, source link and status text are separate HTML |

The wallet sheet rows are at least 52px high. Focus uses explicit `:focus-visible`, including the radio label’s `:has(input:focus-visible)` treatment. Errors announce via alert regions; routine updates use status regions. No information depends on color alone.

Motion is limited to 120ms named-property transitions using `cubic-bezier(.2,0,0,1)` and a 0.96 press scale. It is enabled only under `prefers-reduced-motion: no-preference`. There are no endless animations or page-load entrances. Forced-colors styles preserve control outlines and the selected state.

## Do’s and don’ts

- Reuse the shell, grid and semantic tokens before introducing another surface or text style.
- Keep the vote and its action above the illustration on narrow screens. Put instructions beside the relevant control.
- Preserve distinct unavailable, incomplete, pending and zero states. Never fill a missing measurement, wallet score or public leaderboard with sample data.
- Keep one typography scale and the existing action hierarchy. Decorative illustration colors do not become new button colors.
- Use native controls and disclosures, wrap full addresses, and keep dialogs in the native modal top layer.
- For another page, start with `page-shell`, one task heading, a `surface` section and existing button variants; retain wallet access in the header and use fragment navigation for static hosting.

The six-domain review, fixes and unperformed manual checks are recorded in `artifacts/validation.md`. Design-reference attribution is in `artifacts/NOTICE.md`.
