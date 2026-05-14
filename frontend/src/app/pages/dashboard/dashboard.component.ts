import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AccountService, Account, Transaction } from '../../services/account.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accountService = inject(AccountService);

  protected readonly account = signal<Account | null>(null);
  protected readonly recentTxns = signal<Transaction[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  ngOnInit(): void {
    const accountId = this.auth.getAccountId();
    if (!accountId) return;

    this.accountService.getAccount(accountId).subscribe({
      next: (acc) => {
        this.account.set(acc);
        this.loadRecentTransactions(accountId);
      },
      error: () => {
        this.error.set('Unable to load account data. Please try again.');
        this.loading.set(false);
      },
    });
  }

  private loadRecentTransactions(accountId: string): void {
    this.accountService.getTransactions(accountId).subscribe({
      next: (txns) => {
        this.recentTxns.set(txns.slice(0, 5));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
