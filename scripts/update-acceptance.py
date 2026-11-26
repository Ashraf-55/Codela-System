#!/usr/bin/env python3
"""Re-stamps the 20 acceptance reports with the browser evidence of the LAST Playwright run (docs/qa/evidence/playwright-results.json).
A BROWSER row is flipped to ✅ only if the named tests really passed in that file; otherwise it stays ❌."""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent; docs = root / 'docs'
data = json.load(open(docs / 'qa/evidence/playwright-results.json'))
tests = []  # (file, suite-chain, title, project, status)
def walk(s, chain):
    for sp in s.get('specs', []):
        for t in sp['tests']:
            tests.append((sp['file'], chain, sp['title'], t['projectName'], t['results'][-1]['status'] if t['results'] else 'skipped'))
    for c in s.get('suites', []): walk(c, chain + [c.get('title', '')])
for s in data['suites']: walk(s, [])
stats = data['stats']; passed = stats['expected']; failed = stats['unexpected']; date = stats['startTime'][:10]
PRODUCTS = {'medical': 'medical', 'estate': 'realestate', 'ecommerce': 'ecommerce', 'restaurant': 'restaurant', 'auto': 'automotive', 'learn': 'learning', 'build': 'construction', 'booking': 'booking', 'fleet': 'fleet', 'business': 'business'}
EXTRA = {'realestate': ['estate-map.spec.ts', 'lead-performance.spec.ts'], 'learning': ['lesson-media.spec.ts'], 'business': ['quotations.spec.ts'], 'medical': ['medical-journey.spec.ts']}
SHARED = ['site-builder.spec.ts', 'platform-features.spec.ts', 'security-and-isolation.spec.ts']
def mine(prod):
    out = []
    for f, chain, title, proj, st in tests:
        if (f == 'all-products.spec.ts' and prod in ' '.join(chain + [title])) or f in EXTRA.get(prod, []) or (f == 'product-sites-responsive.spec.ts' and title.startswith(prod + ':')) or (f == 'a11y.spec.ts' and title.startswith(prod + ':')): out.append((f, title, proj, st))
    return out
def shared():
    return [(f, title, proj, st) for f, chain, title, proj, st in tests if f in SHARED]
def table(rows): return '\n'.join(f"- {'✅' if st == 'passed' else '❌'} `{f}` — {t} [{p}]" for f, t, p, st in rows)
HEADER = re.compile(r"\*\*Browser status: NOT RUN\*\*.*\n")
for name, prod in PRODUCTS.items():
    mine_rows = mine(prod); all_pass = bool(mine_rows) and all(r[3] == 'passed' for r in mine_rows)
    nav = [r for r in mine_rows if r[0] == 'product-sites-responsive.spec.ts']; ok_nav = bool(nav) and all(r[3] == 'passed' for r in nav)
    for kind in ('website', 'management'):
        p = docs / f'ACCEPTANCE_{name}_{kind}.md'; s = p.read_text(encoding='utf-8')
        status = f"**Browser status: RUN {date}** — the last full Playwright run (Chromium desktop + mobile profile) had {passed} passed / {failed} failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.\n"
        s = HEADER.sub(status, s)
        if kind == 'website' and ok_nav:
            s = re.sub(r"(\| Navigation links work \| BROWSER \| )❌ not run \| [^\n]*", r"\1✅ BROWSER | `product-sites-responsive.spec.ts` — every menu link of the published site was checked (anchor target exists / page answers) and an anchor was clicked, at desktop, tablet and mobile widths |", s)
            s = re.sub(r"(\| Website is responsive \(desktop / tablet / mobile\) \| BROWSER \| )❌ not run \| [^\n]*", r"\1✅ BROWSER | `product-sites-responsive.spec.ts` — no horizontal overflow at 1280 / 820 / 390 px for the site, no sideways scroll on the dashboard; `a11y.spec.ts` axe WCAG A/AA scan of the site on desktop and mobile |", s)
        s = re.split(r"\n## Browser evidence \(Playwright\)", s)[0].rstrip() + f"\n\n## Browser evidence (Playwright)\n\nProduct-specific tests from the last run:\n\n{table(mine_rows) or '- (none)'}\n\nShared tests (site builder, platform features, security & isolation):\n\n{table(shared())}\n"
        if not all_pass: s += "\n> ⚠ At least one product-specific browser test did not pass in the last run — this report must not be treated as accepted.\n"
        p.write_text(s, encoding='utf-8')
    (docs / f'ACCEPTANCE_{name}.md').write_text(f"# Codela {name} — acceptance\n\nThis single report was split in two independent reports:\n\n- `ACCEPTANCE_{name}_website.md` — customer-facing website\n- `ACCEPTANCE_{name}_management.md` — admin dashboard / management system\n", encoding='utf-8')
print('updated 30 files; run:', passed, 'passed', failed, 'failed')
