# Accessibility report

Scope: the whole application — public platform pages, all ten products' published sites (desktop + mobile), the owner dashboard of every product (dashboard, settings, site builder, team, roles) and the Super Admin login.
Tool: **axe-core 4 via `@axe-core/playwright`**, rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, in Chromium. Spec: `e2e/tests/a11y.spec.ts` (fails on any `serious` / `critical` violation and appends every violation to `docs/qa/evidence/a11y-results.jsonl`).

## What the automated audit found, and what was fixed
| Finding (axe rule) | Where | Fix |
|---|---|---|
| `link-in-text-block` (serious): footer "Codela" link distinguishable by colour only | every published site footer | link is underlined |
| `label-content-name-mismatch` (serious): notifications button's `aria-label` did not contain its visible count | dashboard top bar | label now includes the number |
| `label-content-name-mismatch`: language switch button's label differed from its visible text | public + dashboard | `aria-label` removed (visible text is the name) and `lang` set for the other language |
| `color-contrast` (serious): sidebar section headings (Medical theme, 3.1:1) | dashboard sidebar | muted colour darkened to 5.7:1 |
| `color-contrast`: "info" badge on `/pricing` | pricing, tables | badge colour mixed toward black for every product colour |

After the fixes the audit reports **no violations** on any scanned page (`a11y.spec.ts`, 11 tests passing; no `a11y-results.jsonl` file is produced when nothing is found).
Non-axe issues found by the browser tests and fixed: the dashboard had no `<main>` landmark (now `<main id="main">`); site menu links pointed at sections that did not exist for fresh tenants (dead anchors) — now only shown when the section renders.

## Reviewed by construction / by test (not by axe)
- Semantic HTML: headings, `scope="col"` table headers, `<caption class="sr-only">` on new tables, landmarks (`header`, `nav aria-label="Site"`, `main`, `footer`).
- Keyboard: all new controls are native `<button>/<input>/<select>`; drag-and-drop section ordering keeps the up/down buttons as the keyboard path; the crop dialog is `role="dialog" aria-modal`, focuses its first control, closes on Escape and restores focus (tested: Escape cancels without uploading); a Tab-order test asserts focus never falls to `<body>` on a product site.
- Forms: every input has a visible `<label>` or `aria-label`; invalid slugs set `aria-invalid` and a `role="alert"` message; save/publish messages use `role="alert"`.
- RTL: Arabic is the default and is covered by the responsive specs.

## Not covered (be honest)
- axe finds roughly a third of WCAG problems. **No screen-reader run (NVDA / VoiceOver / TalkBack) was performed.** Focus order of long forms, reading order in RTL and live-region announcements need a human pass.
- Colour contrast was only checked for the default theme and the product colours of the throw-away test businesses; a tenant who picks a low-contrast brand colour can still produce one (the builder computes `on-primary` text automatically, but a very light primary on white backgrounds is the owner's choice).
- Pages behind specific data states (e.g. an order in every status) were not enumerated.
- Not tested: zoom to 200 % / text-spacing overrides, high-contrast mode, `prefers-reduced-motion`.
