import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { publicGuard } from './guards/public.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/welcome/welcome.component').then((m) => m.WelcomeComponent),
  },
  {
    path: 'apply',
    loadComponent: () =>
      import('./pages/apply/apply.component').then((m) => m.ApplyComponent),
  },
  {
    path: 'apply/confirmation',
    loadComponent: () =>
      import('./pages/apply-confirmation/apply-confirmation.component').then(
        (m) => m.ApplyConfirmationComponent,
      ),
  },
  {
    path: 'apply/status',
    loadComponent: () =>
      import('./pages/apply-status/apply-status.component').then(
        (m) => m.ApplyStatusComponent,
      ),
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./pages/setup/setup.component').then((m) => m.SetupComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'transactions',
    loadComponent: () =>
      import('./pages/transactions/transactions.component').then(
        (m) => m.TransactionsComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'payments',
    loadComponent: () =>
      import('./pages/payments/payments.component').then((m) => m.PaymentsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'statements',
    loadComponent: () =>
      import('./pages/statements/statements.component').then((m) => m.StatementsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'settings/notifications',
    loadComponent: () =>
      import('./pages/settings-notifications/settings-notifications.component').then(
        (m) => m.SettingsNotificationsComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'settings/account',
    loadComponent: () =>
      import('./pages/settings-account/settings-account.component').then(
        (m) => m.SettingsAccountComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'merchant',
    loadComponent: () =>
      import('./pages/merchant/merchant.component').then((m) => m.MerchantComponent),
    canActivate: [publicGuard],
  },
  { path: '**', redirectTo: '' },
];
