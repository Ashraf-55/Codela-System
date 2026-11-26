# Codela Learn — acceptance report

Authoring environment of this pass: no network, no browser. **Nothing below was run by the author**; the owner runs `npm run check`. No browser testing.

## Backend (verified earlier: `learning.test.ts` 12 tests, `portal-learning.test.ts` 3, isolation sweep)
Courses/lessons/previews, enrolment (unique pair, capacity, price snapshot), payments (no overpay; free courses paid at once), progress, exams (exact grading, pass mark, attempt limit), assignments, attendance, certificates with public verification, student portal (lessons, progress, exam, assignment, certificate), customer InstaPay / Vodafone Cash on enrolments.

## Added in this pass (written, not executed)
| Area | What | Status |
|---|---|---|
| API | `faq` (public, active only), `review` (public only when approved; created by `submitReview` which needs enrolment code + the student's e-mail; one per enrolment; pending until staff approve), `studentGroup` + `groupMember` (must be enrolled in the group's course, no duplicates, capacity enforced) | written; test `learn-site.test.ts` written, **not run** |
| Website | `LearnSite.tsx`: catalogue filtered / searched / paged on the **server** (category, level, instructor, text), average rating per course, course dialog (instructor, lesson list with free-preview badges, approved reviews), enrolment form, review form, instructors, FAQ | written; not browser-tested |
| Dashboard | Review moderation board (`/app/board?b=reviews`); groups, FAQ via entity screens | written |

## Component status
| Component | Status |
|---|---|
| Public website | Partial: specialised sections written, unverified |
| Dashboard management | Entity screens (courses, lessons, students, …) + live-sessions board + review moderation |
| Specialised system | Partial: no dedicated course-builder screen (lessons/exams/questions use generic forms); groups have no attendance-by-group screen |
| Customer portal (student) | Existing and API-tested; no UI change in this pass |
| Subscription integration | Complete (shared core) |
| Security & tenant isolation | API-level passed earlier; new public action is code+e-mail gated |
| Functional / browser tests | New test not yet run / not tested |

## Known gaps
The catalogue fires one small request per visible course to compute average ratings (a server-side aggregate would be better). Video hosting/streaming is by URL only (no upload pipeline). No course-builder UX.
