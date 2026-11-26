import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { SITE_COPY, defaultSections } from '@codela/shared';
import { employeeAgent, setup, tenantClient } from './_helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const upload = (t: { agent: request.Agent; csrf: string }, purpose: string, name: string) =>
  t.agent.post(`/api/v1/tenant/files?purpose=${purpose}`).set('x-csrf-token', t.csrf).set('x-file-name', name).set('content-type', 'application/octet-stream').send(PNG);
const publicSite = (app: ReturnType<typeof setup>['app'], slug: string) => request(app).get('/api/v1/public/site').set('Host', `${slug}.codela.test`);
const put = (t: { agent: request.Agent; csrf: string }, u: string, b: object) => t.agent.put(u).set('x-csrf-token', t.csrf).send(b);
type Sec = { type: string; enabled: boolean; content: { title?: string; text?: string; items?: { title?: string; text?: string; photoUrl?: string }[] } };

describe('website builder: every product starts with real "who we are / what we do" content', () => {
  it('a new site of each of the 10 products is pre-filled with about, services (4 items), hours and contact', async () => {
    const { app } = setup();
    for (const product of Object.keys(SITE_COPY)) {
      const slug = `wb-${product}`; const t = await tenantClient(app, slug, product);
      const draft = (await t.agent.get('/api/v1/tenant/site')).body.data.draft as { sections: Sec[]; hours: { weekly: unknown[] } };
      const by = (type: string) => draft.sections.find((s) => s.type === type);
      expect(by('hero')?.content.title, `${product} hero`).toContain(`Biz ${slug}`);
      expect((by('about')?.content.text ?? '').length, `${product} about`).toBeGreaterThan(60);
      expect(by('about')?.content.items?.length, `${product} highlights`).toBe(4);
      expect(by('services')?.content.items?.length, `${product} services`).toBe(4);
      expect(by('services')?.content.items?.every((x) => x.title && x.text)).toBe(true);
      expect(by('hours')?.enabled).toBe(true); expect(draft.hours.weekly).toHaveLength(7);
      // nothing is public until the owner publishes
      expect((await publicSite(app, slug)).status).toBe(404);
      expect((await t.post('/api/v1/tenant/site/publish')).status).toBe(200);
      const pub = (await publicSite(app, slug)).body.data as { sections: Sec[]; hours: unknown };
      expect(pub.sections.find((s) => s.type === 'services')?.content.items).toHaveLength(4); expect(pub.hours).toBeTruthy();
    }
  });
  it('the default copy follows the business language and the business name', () => {
    for (const product of Object.keys(SITE_COPY)) {
      const en = defaultSections(product, 'en', 'Nile Co'); const ar = defaultSections(product, 'ar', 'Nile Co');
      expect(/[\u0600-\u06FF]/.test(en.map((x) => JSON.stringify(x.content)).join(''))).toBe(false);
      expect(/[\u0600-\u06FF]/.test(ar.find((x) => x.type === 'about')!.content.text!)).toBe(true);
      expect(en[0].content.title).toContain('Nile Co'); expect(en.find((x) => x.type === 'services')!.content.items).toHaveLength(4);
    }
  });
});

describe('website builder: SEO, hours/holidays, team, gallery, theme render on the PUBLISHED site only', () => {
  const base = (name: string) => ({ templateKey: 'classic', brand: { name, primaryColor: '#0e7490', secondaryColor: '#15803d', description: 'We care', socials: { instagram: 'https://instagram.com/alpha' }, phone: '0100', email: 'a@b.co', address: '1 Nile St' } });

  it('saves every field, hides drafts until republish, and keeps seo/hours/theme when an older client omits them', async () => {
    const { app } = setup(); const t = await tenantClient(app, 'wb-full', 'business');
    const logo = await upload(t, 'site', 'team.png'); expect(logo.status).toBe(201); const photo = logo.body.data.url as string; expect(photo).toMatch(/^\/api\/v1\/public\/files\//);
    const body = { ...base('Alpha Co'),
      sections: [{ type: 'hero', enabled: true, content: { title: 'Welcome Alpha', text: 'We build.' } },
        { type: 'team', enabled: true, content: { title: 'Meet us', items: [{ title: 'Mona Ali', text: 'CEO', photoUrl: photo }] } },
        { type: 'gallery', enabled: true, content: { items: [{ title: 'Office', photoUrl: photo }] } },
        { type: 'faq', enabled: true, content: { items: [{ title: 'Do you ship?', text: 'Yes.' }] } }, { type: 'hours', enabled: true, content: {} }],
      seo: { title: 'Alpha — best consulting', description: 'Consulting for growing companies', ogImage: photo, keywords: 'consulting, cairo', noindex: false },
      hours: { weekly: [{ day: 0, closed: false, open: '08:00', close: '16:30' }, { day: 5, closed: true, open: '09:00', close: '17:00' }], holidays: [{ date: '2027-01-07', label: 'Christmas' }] },
      theme: { font: 'serif', layout: 'wide', header: 'centered', footer: 'columns' } };
    expect((await put(t, '/api/v1/tenant/site', body)).status).toBe(200);
    expect((await publicSite(app, 'wb-full')).status).toBe(404); // saved is not published
    expect((await t.post('/api/v1/tenant/site/publish')).status).toBe(200);
    const pub = (await publicSite(app, 'wb-full')).body.data;
    expect(pub.seo).toMatchObject({ title: 'Alpha — best consulting', description: 'Consulting for growing companies', ogImage: photo, keywords: 'consulting, cairo' });
    expect(pub.hours.weekly.find((d: { day: number }) => d.day === 0)).toMatchObject({ open: '08:00', close: '16:30' }); expect(pub.hours.holidays).toEqual([{ date: '2027-01-07', label: 'Christmas' }]);
    expect(pub.theme).toEqual({ font: 'serif', layout: 'wide', header: 'centered', footer: 'columns' });
    expect(pub.sections.find((s: Sec) => s.type === 'team').content.items[0]).toMatchObject({ title: 'Mona Ali', text: 'CEO', photoUrl: photo });
    expect(pub.sections.find((s: Sec) => s.type === 'gallery').content.items[0].photoUrl).toBe(photo);
    expect(pub.brand.socials.instagram).toBe('https://instagram.com/alpha'); expect(pub.brand.phone).toBe('0100'); expect(pub.brand.address).toBe('1 Nile St');
    expect((await request(app).get(photo).set('Host', 'wb-full.codela.test')).status).toBe(200); // the uploaded image is publicly served

    // a later draft stays hidden until republished
    expect((await put(t, '/api/v1/tenant/site', { ...body, seo: { title: 'DRAFT ONLY' } })).status).toBe(200);
    expect((await publicSite(app, 'wb-full')).body.data.seo.title).toBe('Alpha — best consulting');
    // an older client that sends no seo/hours/theme must not wipe them
    const { seo: _s, hours: _h, theme: _t, ...legacy } = body; void _s; void _h; void _t;
    const kept = (await put(t, '/api/v1/tenant/site', legacy)).body.data.draft; expect(kept.seo.title).toBe('DRAFT ONLY'); expect(kept.hours.weekly).toHaveLength(2); expect(kept.theme.font).toBe('serif');
    await t.post('/api/v1/tenant/site/publish'); expect((await publicSite(app, 'wb-full')).body.data.seo.title).toBe('DRAFT ONLY');
  });

  it('validates everything the owner can type', async () => {
    const { app } = setup(); const t = await tenantClient(app, 'wb-bad', 'booking'); const ok = { ...base('X'), sections: [{ type: 'hero', enabled: true, content: {} }] };
    expect((await put(t, '/api/v1/tenant/site', ok)).status).toBe(200);
    const bad: object[] = [
      { ...ok, seo: { title: 'x'.repeat(71) } }, { ...ok, seo: { description: 'x'.repeat(201) } }, { ...ok, seo: { ogImage: 'javascript:alert(1)' } }, { ...ok, seo: { unknown: 1 } },
      { ...ok, hours: { weekly: [{ day: 1, closed: false, open: '18:00', close: '09:00' }], holidays: [] } }, { ...ok, hours: { weekly: [{ day: 1, open: '9am', close: '5pm' }], holidays: [] } },
      { ...ok, hours: { weekly: [{ day: 7, open: '09:00', close: '10:00' }], holidays: [] } }, { ...ok, hours: { weekly: [{ day: 1 }, { day: 1 }], holidays: [] } }, { ...ok, hours: { weekly: [], holidays: [{ date: '07/01/2027' }] } },
      { ...ok, theme: { font: 'comic-sans' } }, { ...ok, theme: { header: 'x' } },
      { ...ok, sections: [{ type: 'team', enabled: true, content: { items: [{ title: 'A', photoUrl: 'javascript:alert(1)' }] } }] },
      { ...ok, sections: [{ type: 'team', enabled: true, content: { items: [{ title: 'A', photoUrl: '/etc/passwd' }] } }] },
      { ...ok, sections: [{ type: 'faq', enabled: true, content: { items: Array.from({ length: 41 }, () => ({ title: 'q' })) } }] },
      { ...ok, sections: [{ type: 'faq', enabled: true, content: { items: [{ title: 'q', evil: '<script>' }] } }] },
    ];
    for (const [i, b] of bad.entries()) expect((await put(t, '/api/v1/tenant/site', b)).status, `bad #${i}`).toBe(400);
  });

  it('only owners with tenant.settings can upload site images; they are public, images only, and tenant-owned', async () => {
    const { app } = setup(); const owner = await tenantClient(app, 'wb-up', 'booking'); const emp = await employeeAgent(app, owner, 'wb-up');
    expect((await upload(owner, 'site', 'a.png')).status).toBe(201);
    const e = await emp.agent.post('/api/v1/tenant/files?purpose=site').set('x-csrf-token', emp.csrf).set('x-file-name', 'a.png').set('content-type', 'application/octet-stream').send(PNG);
    expect(e.status).toBe(403);
    const bad = await owner.agent.post('/api/v1/tenant/files?purpose=site').set('x-csrf-token', owner.csrf).set('x-file-name', 'a.pdf').set('content-type', 'application/octet-stream').send(Buffer.from('%PDF-1.7\n'));
    expect(bad.status).toBe(415);
  });
});
