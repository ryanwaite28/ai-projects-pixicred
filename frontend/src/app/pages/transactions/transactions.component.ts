import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { AccountService, Transaction } from '../../services/account.service';

@Component({
  selector: 'app-transactions',
  imports: [CommonModule, CurrencyPipe, DatePipe],
  templateUrl: './transactions.component.html',
})
export class TransactionsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private accountId = '';

  protected readonly transactions    = signal<Transaction[]>([]);
  protected readonly loading         = signal(true);
  protected readonly loadingMore     = signal(false);
  protected readonly hasMore         = signal(true);
  protected readonly error           = signal('');

  protected readonly showDisputeModal = signal(false);
  protected readonly pendingDisputeId = signal<string | null>(null);
  protected readonly pendingDisputeTx = computed(() =>
    this.transactions().find((t) => t.transactionId === this.pendingDisputeId()) ?? null,
  );
  protected readonly disputing        = signal(false);
  protected readonly disputeError     = signal<string | null>(null);

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

  protected openDisputeModal(tx: Transaction): void {
    this.pendingDisputeId.set(tx.transactionId);
    this.disputeError.set(null);
    this.showDisputeModal.set(true);
  }

  protected cancelDispute(): void {
    this.showDisputeModal.set(false);
    this.pendingDisputeId.set(null);
    this.disputeError.set(null);
  }

  protected confirmDispute(): void {
    const txId = this.pendingDisputeId();
    if (!txId || this.disputing()) return;
    this.disputing.set(true);
    this.disputeError.set(null);
    this.accountService.disputeTransaction(this.accountId, txId).subscribe({
      next: (updated) => {
        this.transactions.update((list) =>
          list.map((t) => (t.transactionId === txId ? updated : t)),
        );
        this.showDisputeModal.set(false);
        this.pendingDisputeId.set(null);
        this.disputing.set(false);
      },
      error: (err) => {
        const msg: string = err?.error?.error?.message ?? 'Dispute failed. Please try again.';
        this.disputeError.set(msg);
        this.disputing.set(false);
      },
    });
  }
}
