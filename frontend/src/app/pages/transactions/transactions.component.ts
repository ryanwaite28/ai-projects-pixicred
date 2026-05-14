import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { AccountService, Transaction } from '../../services/account.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';

@Component({
  selector: 'app-transactions',
  imports: [CommonModule, CurrencyPipe, DatePipe, NavbarComponent],
  templateUrl: './transactions.component.html',
})
export class TransactionsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private accountId = '';

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(true);
  protected readonly error = signal('');

  ngOnInit(): void {
    this.accountId = this.auth.getAccountId() ?? '';
    this.loadPage();
  }

  private loadPage(cursor?: string): void {
    const isFirstPage = !cursor;
    if (isFirstPage) this.loading.set(true);
    else this.loadingMore.set(true);

    this.accountService.getTransactions(this.accountId, cursor).subscribe({
      next: (txns) => {
        this.transactions.update((prev) => (isFirstPage ? txns : [...prev, ...txns]));
        this.hasMore.set(txns.length === this.accountService.pageSize);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.error.set('Unable to load transactions. Please try again.');
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }

  protected loadMore(): void {
    const txns = this.transactions();
    const last = txns[txns.length - 1];
    if (last) this.loadPage(last.transactionId);
  }
}
