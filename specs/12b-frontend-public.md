# Spec: Frontend — Public Apply Flow (Phase 10b)
**FR references**: FR-FE-01, FR-FE-02, FR-FE-03, FR-FE-04
**Status**: ✅ Implemented
**Prerequisite**: Phase 10a (routing + auth shell in place)

---

## What

Phase 10b implements the four public-facing pages: the welcome/landing page, the credit card application form, the application confirmation page, and the application status check page. All four pages are unauthenticated. They form the complete top-of-funnel user journey from discovery to application decision.

---

## Why

FR-FE-01 through FR-FE-04 define the public entry point of the product. These pages exist independent of portal authentication and drive the credit application flow.

---

## New / Modified Files

- `frontend/src/app/pages/welcome/welcome.component.ts` — hero, feature overview, Apply + Login CTAs
- `frontend/src/app/pages/apply/apply.component.ts` — application form; calls `POST /applications`
- `frontend/src/app/services/application.service.ts` — `submitApplication()`, `getApplicationStatus()`
- `frontend/src/app/pages/apply-confirmation/apply-confirmation.component.ts` — displays `applicationId` as confirmation code
- `frontend/src/app/pages/apply-status/apply-status.component.ts` — status check by confirmation code

---

## Behavior

### Welcome page (`/`)

- PixiCred Tailwind theme layout: hero section with product name "PixiCred" and tagline
- Two primary CTAs: "Apply Now" → `/apply`; "Login" → `/login`
- Brief feature section (3 cards): No annual fee / Build credit / Instant decision
- No API calls

### Apply page (`/apply`)

- Reactive form fields: `firstName` (required), `lastName` (required), `email` (required, email validator), `dateOfBirth` (required, date input), `annualIncome` (required, number, min 0), `mockSsn` (required, exactly 5 digits)
- On valid submit: calls `applicationService.submitApplication(form.value)`
- Shows loading indicator during API call; disables form
- On success (`201`): stores `applicationId` in router navigation state; navigates to `/apply/confirmation`
- On error: displays API error message inline; re-enables form

### `ApplicationService`

```typescript
submitApplication(input: SubmitApplicationInput): Observable<{ applicationId: string }>
// POST /applications

getApplicationStatus(applicationId: string): Observable<ApplicationStatusResponse>
// GET /applications/:applicationId
// Returns: { applicationId, status, firstName } (shape matches API response)
```

No auth header injected (public routes bypassed by auth interceptor).

### Application confirmation page (`/apply/confirmation`)

- Reads `applicationId` from router navigation state; redirects to `/apply` if not present
- Displays `applicationId` prominently, labelled "Your Confirmation Code"
- Instructs user to save the code and check status at `/apply/status`
- "Check Status" button → navigates to `/apply/status`
- No API calls

### Application status page (`/apply/status`)

- Text input for confirmation code (`applicationId`); "Check Status" button
- On submit: calls `applicationService.getApplicationStatus(code)`
- Status display:
  - `PENDING`: "Your application is being reviewed. Check back soon."
  - `APPROVED`: "Congratulations! Your application was approved. Check your email for your Account Setup Code and visit the setup page to create your account." → link to `/setup`
  - `DECLINED`: "We were unable to approve your application at this time."
- Shows loading state during API call
- Error state: displays API error (e.g. invalid confirmation code)

---

## Done When
- [x] Welcome page renders with Apply and Login CTAs navigating to correct routes (FR-FE-01)
- [x] Apply form validates all fields; `mockSsn` enforces exactly 5 digits; calls `POST /applications` on submit (FR-FE-02)
- [x] Apply form on success navigates to confirmation with `applicationId` in router state (FR-FE-02)
- [x] Confirmation page displays `applicationId` prominently as confirmation code; redirects to `/apply` if no router state (FR-FE-03)
- [x] Status page calls `GET /applications/:id`; renders all three status states (PENDING, APPROVED, DECLINED) correctly (FR-FE-04)
- [x] Status page shows APPROVED prompt with link to `/setup` (FR-FE-04)
- [x] All pages use PixiCred shared utility classes (.pxc-card, .pxc-btn-primary, .pxc-input) — no inline or ad-hoc styling
- [x] New control flow syntax used throughout (`@if`, `@for`, `@switch`)
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 10b row marked complete
