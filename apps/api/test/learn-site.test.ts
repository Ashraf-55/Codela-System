import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

describe('learning: reviews, FAQ and class groups', () => {
  it('reviews need an enrolled student and staff approval; FAQ shows active only; groups check enrolment, duplicates and capacity', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'lrn', 'learning'); const h = 'lrn.codela.test';
    const ins = (await o.create('instructor', { name: 'Dr X' })).body.data; const course = (await o.create('course', { title: 'Front-End', instructorId: ins.id, price: 50000 })).body.data;
    await o.create('lesson', { courseId: course.id, title: 'L1', position: 1, durationMin: 5 }); expect((await o.patch('course', course.id, { status: 'published' })).status).toBe(200);
    const reg = (email: string) => request(app).post('/api/v1/public/actions/register').set('Host', h).send({ student: { name: email.split('@')[0], email, phone: '01011112222' }, courseId: course.id });
    const r1 = await reg('sara@x.com'); expect(r1.status).toBe(201); const code = r1.body.data.enrollmentCode as string;
    const review = (b: object) => request(app).post('/api/v1/public/actions/submitReview').set('Host', h).send(b);
    expect((await review({ enrollmentCode: code, email: 'other@x.com', rating: 5 })).status).toBe(404);                 // wrong e-mail
    expect((await review({ enrollmentCode: code, email: 'sara@x.com', rating: 6 })).status).toBe(400);
    expect((await review({ enrollmentCode: code, email: 'sara@x.com', rating: 5, comment: 'Great course' })).status).toBe(201);
    expect((await review({ enrollmentCode: code, email: 'sara@x.com', rating: 4 })).status).toBe(409);                   // one review per enrolment
    const pub = () => request(app).get(`/api/v1/public/catalog/review?courseId=${course.id}`).set('Host', h);
    expect((await pub()).body.data).toHaveLength(0);                                                                      // pending is hidden
    const id = (await o.list('review')).body.data[0].id; expect((await o.patch('review', id, { status: 'approved' })).status).toBe(200);
    const shown = (await pub()).body.data; expect(shown).toHaveLength(1); expect(shown[0]).toMatchObject({ authorName: 'sara', rating: 5 }); expect(JSON.stringify(shown)).not.toMatch(/studentId|email/);

    // server-side rating aggregate: only APPROVED reviews count; the client cannot write it; it is public on the catalogue
    expect((await o.get('course', course.id)).body.data.data).toMatchObject({ ratingAvg100: 500, ratingCount: 1 });
    expect([200, 400]).toContain((await o.patch('course', course.id, { ratingAvg100: 100, ratingCount: 99 })).status); // readonly: dropped or refused, never applied expect((await o.get('course', course.id)).body.data.data).toMatchObject({ ratingAvg100: 500, ratingCount: 1 });
    const pc = (await request(app).get('/api/v1/public/catalog/course').set('Host', h)).body.data[0]; expect(pc).toMatchObject({ ratingAvg100: 500, ratingCount: 1 });
    expect((await o.patch('review', id, { status: 'hidden' })).status).toBe(200); expect((await o.get('course', course.id)).body.data.data).toMatchObject({ ratingAvg100: 0, ratingCount: 0 });
    expect((await o.patch('review', id, { status: 'approved' })).status).toBe(200); expect((await o.agent.delete(`/api/v1/tenant/p/review/${id}`).set('x-csrf-token', o.csrf)).status).toBeGreaterThanOrEqual(400); // reviews are hidden, never deleted

    await o.create('faq', { question: 'Certificate?', answer: 'Yes', position: 1 }); await o.create('faq', { question: 'Hidden', answer: 'x', active: false });
    expect((await request(app).get('/api/v1/public/catalog/faq').set('Host', h)).body.data.map((f: { question: string }) => f.question)).toEqual(['Certificate?']);

    const sara = (await o.list('student', '?q=sara')).body.data[0]; const r2 = await reg('omar@x.com'); expect(r2.status).toBe(201); const omar = (await o.list('student', '?q=omar')).body.data[0];
    const nobody = (await o.create('student', { name: 'Nina', email: 'nina@x.com' })).body.data;
    const g = (await o.create('studentGroup', { name: 'Sat 6pm', courseId: course.id, capacity: 1, schedule: 'Sat 18:00' })).body.data;
    expect((await o.create('groupMember', { groupId: g.id, studentId: nobody.id })).body.error.code).toBe('NOT_ENROLLED');
    expect((await o.create('groupMember', { groupId: g.id, studentId: sara.id })).status).toBe(201);
    expect((await o.create('groupMember', { groupId: g.id, studentId: sara.id })).body.error.code).toBe('ALREADY_MEMBER');
    expect((await o.create('groupMember', { groupId: g.id, studentId: omar.id })).body.error.code).toBe('GROUP_FULL');
  });
});
