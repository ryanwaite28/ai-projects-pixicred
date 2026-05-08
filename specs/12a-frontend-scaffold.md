# Spec: Frontend — Scaffold & Auth Shell (Phase 10a)
**FR references**: FR-FE-13, FR-FE-14, FR-FE-15, FR-FE-17, FR-AUTH-02, FR-AUTH-03
**Status**: 🔄 In Progress
**Prerequisite**: Phase 9 (`POST /auth/register` and `POST /auth/login` live)

---

## What

Phase 10a scaffolds the Angular 17+ workspace and establishes all cross-cutting frontend infrastructure: routing config with all routes declared (public and protected), environment files, proxy config, the auth service (JWT storage and API calls), auth interceptor, auth guard, and the two auth-flow pages (login and account setup). All subsequent frontend phases add pages on top of this foundation without modifying its core files.

---

## Why

FR-FE-13 requires protected routes; FR-FE-14 requires the auth interceptor and guard; FR-FE-17 requires local proxy. Building the auth shell first means all subsequent page phases can assume routing, protection, and HTTP interception are already wired.

---

## New / Modified Files

- `frontend/` — new Angular workspace (`ng new pixicred-frontend --standalone --routing --style=scss`)
- `frontend/src/environments/environment.ts` — `{ apiUrl: 'http://localhost:3000' }`
- `frontend/src/environments/environment.prod.ts` — `{ apiUrl: 'https://api.pixicred.com' }`
- `frontend/proxy.conf.json` — proxies `/api/**` → `http://localhost:3000`
- `frontend/src/app/app.routes.ts` — complete route table with all pages + `canActivate: [authGuard]` on protected routes
- `frontend/src/app/services/auth.service.ts` — JWT store/retrieve/clear; `register()`, `login()`, `logout()`, `isAuthenticated()`, `getAccountId()`
- `frontend/src/app/interceptors/auth.interceptor.ts` — injects `Authorization: Bearer <jwt>` on non-public requests; clears JWT and redirects to `/login` on 401/403
- `frontend/src/app/guards/auth.guard.ts` — redirects to `/login` when JWT absent or expired; checks expiry client-side via `exp` claim
- `frontend/src/app/pages/login/login.component.ts` — login form; calls `AuthService.login()`; redirects to `/dashboard` on success
- `frontend/src/app/pages/setup/setup.component.ts` — account setup form; calls `AuthService.register()`; redirects to `/login` on success

---

## Behavior

### Route table (`app.routes.ts`)

```typescript
export const routes: Routes = [
  { path: '',              loadComponent: () => import('./pages/welcome/welcome.component') },
  { path: 'apply',        loadComponent: () => import('./pages/apply/apply.component') },
  { path: 'apply/confirmation', loadComponent: () => import('./pages/apply-confirmation/...') },
  { path: 'apply/status', loadComponent: () => import('./pages/apply-status/...') },
  { path: 'setup',        loadComponent: () => import('./pages/setup/setup.component') },
  { path: 'login',        loadComponent: () => import('./pages/login/login.component') },
  { path: 'dashboard',    loadComponent: () => import('./pages/dashboard/...'), canActivate: [authGuard] },
  { path: 'transactions', loadComponent: () => import('./pages/transactions/...'), canActivate: [authGuard] },
  { path: 'payments',     loadComponent: () => import('./pages/payments/...'), canActivate: [authGuard] },
  { path: 'statements',   loadComponent: () => import('./pages/statements/...'), canActivate: [authGuard] },
  { path: 'settings/notifications', loadComponent: () => import('./pages/settings-notifications/...'), canActivate: [authGuard] },
  { path: 'settings/account',       loadComponent: () => import('./pages/settings-account/...'), canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
```

All components are lazy-loaded standalone components. No `NgModule` anywhere.

### `AuthService`

- JWT stored in `localStorage` under key `pixicred_jwt`
- `login(email, password)` — calls `POST /auth/login`; on success stores token and returns `accountId`
- `register(email, accountId, password)` — calls `POST /auth/register`
- `logout()` — removes `pixicred_jwt` from localStorage
- `isAuthenticated()` — returns `true` if JWT present and `exp` claim is in the future
- `getAccountId()` — decodes `accountId` from JWT payload; returns `null` if no valid token
- Uses Angular `HttpClient`; returns `Observable<T>`

### Auth interceptor

- Reads JWT from `localStorage`
- Skips injection for: `/auth/register`, `/auth/login`, `GET /applications/**`
- Appends `Authorization: Bearer <token>` to all other requests
- On response `401` or `403`: calls `AuthService.logout()` and `router.navigate(['/login'])`

### Auth guard (`authGuard`)

Functional guard:
```typescript
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? true : inject(Router).createUrlTree(['/login']);
};
```

### Login page

- Reactive form: `email` (required, email validator), `password` (required)
- On submit: calls `authService.login(email, password)`
- On success: stores JWT, navigates to `/dashboard`
- On error: displays error message from API response
- Shows success notice when navigated from `/setup` (via router state)

### Account setup page

- Reactive form: `email` (required), `accountId` (required, labelled "Account Setup Code"), `password` (required, min 8), `confirmPassword` (must match `password`)
- On submit: calls `authService.register(email, accountId, password)`
- On success: navigates to `/login` with success notice via router state
- On error: displays error message

---

## Done When
- [ ] `ng serve` starts on port 4200 with no compilation errors
- [ ] All routes declared in `app.routes.ts` resolve to valid component files (stubs acceptable for pages not yet implemented)
- [ ] Auth guard redirects unauthenticated users to `/login` on all protected routes
- [ ] Auth interceptor injects Bearer token on protected requests; skips public routes
- [ ] Auth interceptor clears JWT and redirects to `/login` on 401/403
- [ ] Login form validates, calls API, stores JWT, and navigates to `/dashboard` on success
- [ ] Setup form validates (including password-match check), calls API, and navigates to `/login` on success
- [ ] JWT stored in `localStorage` under key `pixicred_jwt`; never in cookies
- [ ] All components are standalone — no NgModule in the codebase
- [ ] New control flow syntax (`@if`, `@for`) used — no `*ngIf` / `*ngFor`
- [ ] Spec status updated to ✅ Implemented
- [ ] IMPLEMENTATION_PLAN.md Phase 10a row marked complete
