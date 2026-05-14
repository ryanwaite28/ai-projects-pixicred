import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { AccountService, Statement, StatementDetail } from '../../services/account.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';

@Component({
  selector: 'app-statements',
  imports: [CommonModule, CurrencyPipe, DatePipe, NavbarComponent],
  templateUrl: './statements.component.html',
})
export class StatementsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private accountId = '';

  protected readonly statements = signal<Statement[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly expandedId = signal<string | null>(null);
  protected readonly expandedDetail = signal<StatementDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal('');

  protected readonly generating = signal(false);
  protected readonly generateError = signal('');

  ngOnInit(): void {
    this.accountId = this.auth.getAccountId() ?? '';
    this.accountService.getStatements(this.accountId).subscribe({
      next: (list) => {
        this.statements.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Unable to load statements. Please try again.');
        this.loading.set(false);
      },
    });
  }

  protected toggleDetail(statementId: string): void {
    if (this.expandedId() === statementId) {
      this.expandedId.set(null);
      this.expandedDetail.set(null);
      return;
    }
    this.expandedId.set(statementId);
    this.expandedDetail.set(null);
    this.detailError.set('');
    this.detailLoading.set(true);

    this.accountService.getStatement(this.accountId, statementId).subscribe({
      next: (detail) => {
        this.expandedDetail.set(detail);
        this.detailLoading.set(false);
      },
      error: () => {
        this.detailError.set('Unable to load statement detail.');
        this.detailLoading.set(false);
      },
    });
  }

  protected generate(): void {
    if (this.generating()) return;
    this.generateError.set('');
    this.generating.set(true);

    this.accountService.generateStatement(this.accountId).subscribe({
      next: (s) => {
        this.statements.update((prev) => [s, ...prev]);
        this.generating.set(false);
      },
      error: (err) => {
        const msg: string = err?.error?.error?.message ?? 'Failed to generate statement.';
        this.generateError.set(msg);
        this.generating.set(false);
      },
    });
  }
}
