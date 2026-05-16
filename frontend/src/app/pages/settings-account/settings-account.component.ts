import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AccountService, Account } from '../../services/account.service';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-settings-account',
  imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink, RouterLinkActive],
  templateUrl: './settings-account.component.html',
})
export class SettingsAccountComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly settingsService = inject(SettingsService);
  private readonly router = inject(Router);
  private accountId = '';

  protected readonly account = signal<Account | null>(null);
  protected readonly email = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');

  protected readonly showModal = signal(false);
  protected readonly closing = signal(false);
  protected readonly closeError = signal('');

  protected readonly renewingCard = signal(false);
  protected readonly renewError = signal<string | null>(null);
  protected readonly renewSuccess = signal(false);
  protected readonly copiedCard = signal(false);

  ngOnInit(): void {
    this.accountId = this.auth.getAccountId() ?? '';
    this.email.set(this.auth.getEmail());

    this.accountService.getAccount(this.accountId).subscribe({
      next: (acc) => {
        this.account.set(acc);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Unable to load account information.');
        this.loading.set(false);
      },
    });
  }

  protected openModal(): void  { this.showModal.set(true); this.closeError.set(''); }
  protected cancelModal(): void { this.showModal.set(false); }

  protected formatCardNumber(n: string): string {
    return n.replace(/(.{4})/g, '$1 ').trim();
  }

  protected formatExpiry(iso: string): string {
    const [year, month] = iso.split('-');
    return `${month}/${year}`;
  }

  protected copyCardNumber(n: string): void {
    void navigator.clipboard.writeText(n).then(() => {
      this.copiedCard.set(true);
      setTimeout(() => this.copiedCard.set(false), 2000);
    });
  }

  protected renewCard(): void {
    if (this.renewingCard()) return;
    this.renewingCard.set(true);
    this.renewError.set(null);
    this.renewSuccess.set(false);

    this.accountService.renewCard(this.accountId).subscribe({
      next: (updated) => {
        this.account.set(updated);
        this.renewingCard.set(false);
        this.renewSuccess.set(true);
        setTimeout(() => this.renewSuccess.set(false), 4000);
      },
      error: (err) => {
        this.renewingCard.set(false);
        const msg: string = err?.error?.error?.message ?? 'Failed to renew card. Please try again.';
        this.renewError.set(msg);
      },
    });
  }

  protected confirmClose(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.closeError.set('');

    this.settingsService.closeAccount(this.accountId).subscribe({
      next: () => {
        this.auth.logout();
        this.router.navigate(['/'], { queryParams: { farewell: '1' } });
      },
      error: (err) => {
        this.closing.set(false);
        this.showModal.set(false);
        const msg: string = err?.error?.error?.message ?? 'Failed to close account. Please try again.';
        this.closeError.set(msg);
      },
    });
  }
}
