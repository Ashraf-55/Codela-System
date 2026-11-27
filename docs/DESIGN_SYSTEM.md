# Codela design system v3

Source of truth: `apps/web/src/app/globals.css` (tokens, base, components, shells, marketing, tenant-site base) and `apps/web/src/app/design-v2.css` (per-product identity). Product colours come from `packages/design` (`PRODUCT_THEMES`, WCAG-AA tested) and are injected per tenant by `themeToCssVars()`.

## Principles
1. **One system, ten identities.** Every dashboard uses the same UI face, neutral surfaces, controls and spacing, so tables and forms read the same in every product. Identity lives in the sidebar palette, the accent colour and the page-title face. Public tenant websites carry the full product typography and hero treatment.
2. **Data first.** Numbers use tabular figures in the UI face (`.mono` no longer switches to a monospace font). Money in KPI tiles shows the amount large with the currency code small (`MoneyFigure`), so figures never wrap.
3. **Nothing decorative that does nothing.** Every control is wired; empty states say what to do next; errors say what went wrong.
4. **Accessible by construction.** Visible focus, keyboard-reachable sorting, `aria-invalid` + `aria-describedby` on form errors, native `<dialog>` for confirmations, `role=status` toasts, combobox semantics on search, label-in-name respected (axe clean).

## Tokens
| Group | Tokens |
|---|---|
| Brand (platform) | `--color-primary #0d7068`, `--signal #f5b83d`, `--ink #0b1b2b` (products override primary/accent) |
| Neutrals (light / dark) | `--bg #f6f7f9 / #0a111b`, `--surface #fff / #101924`, `--surface-2`, `--surface-3`, `--border`, `--border-strong`, `--subtle` |
| Status | `--ok`, `--warn`, `--danger`, `--info` (both themes) |
| Type | `--font-ui-en` Plus Jakarta Sans (self-hosted), `--font-ui-ar` IBM Plex Sans Arabic (self-hosted); scale `--fs-xs … --fs-2xl` |
| Radius | `--r-xs 6` · `--r-sm 8` · `--r-md 10` · `--r-lg 14` · `--r-xl 20` · `--r-full` (Construction tightens them) |
| Elevation | `--shadow-xs/-sm/-md/-lg` (flattened in dark mode) |
| Motion | `--ease`, `--t-fast .12s`, `--t .18s`; all motion off under `prefers-reduced-motion` |

Dark mode follows the OS until the person chooses (account menu or theme button); the choice is stored in `localStorage`.

## Components (class → use)
`btn` (+ `primary`, `ghost`, `danger`, `signal`, `sm`, `lg`, `icon-only`, `block`) · `icon-btn` · `field` / `hint` / `err` / `req` · `card` (+ `flat`, `kpi`) · `kpi-grid` · `badge` (+ `ok`, `warn`, `bad`, `info`, with status dot) · `alert` (+ `error`, `ok`, `warn`, `info`) · `table-wrap` + sortable `sort-btn` headers · `tabs` (segmented) · `empty` · `page-head` · `skeleton` · `bar` · `dl` · `dropdown` · `menu` / `menu-pop` · `avatar` · `toasts` / `toast` · `dialog.modal`.

React helpers: `Icon` (`components/Icon.tsx`, ~60 inline stroke icons, `PRODUCT_ICON`), `toast(text, tone)` and `confirmDialog(message, { danger, confirmLabel })` (`components/Providers.tsx`), `MoneyFigure` (`components/app/Cells.tsx`).

## Shells
* **Tenant dashboard** (`AppShell`): sidebar with product mark, workspace screens (data-driven, de-duplicated), a collapsible, filterable *Records* group, settings group; top bar with ⌘K/Ctrl+K search (listbox, arrow keys, Enter), notifications, account menu (theme, language, settings, billing, log out). Below 960 px: drawer with backdrop, Escape closes.
* **Super Admin** (`AdminShell`): grouped navigation with icons and the same mobile drawer (previously unreachable on phones).
* **Marketing**: sticky translucent header, hero with a live-HTML product preview, product grid, platform features, steps, CTA band, four-column footer.

## Product identities
| Product | Sidebar | Title face | Site hero |
|---|---|---|---|
| Medical | light, teal accent | IBM Plex Sans | soft clinical gradient with a cross mark |
| Real Estate | deep green, gold | Fraunces | deep green, gold glow, square cards |
| E-Commerce | violet, pink | DM Sans | violet→magenta gradient, pill buttons |
| Restaurant | espresso, amber | Playfair Display | warm radial, dashed menu cards |
| Automotive | slate, red | Barlow Condensed (caps) | angled dark hero, red rules |
| Learning | deep teal, yellow | Nunito Sans | teal gradient, accent-edged cards |
| Construction | graphite, orange, tight radii | Archivo | hazard-stripe texture, square corners |
| Booking | plum, pink, round | Manrope | pastel gradient, pill controls |
| Fleet | navy grid, sky | Space Grotesk | navy map grid |
| Business | indigo, green | Inter Tight | indigo gradient |

Product display faces are loaded from Google Fonts at runtime (`lib/fonts.ts`) and fall back to the self-hosted UI faces offline.
