import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type TransactionType = 'CHARGE' | 'PAYMENT';

export interface Account {
  accountId: string;
  creditLimit: number;
  currentBalance: number;
  availableCredit: number;
  status: AccountStatus;
  satisfied: boolean;
  paymentDueDate: string;
  createdAt: string;
}

export interface Transaction {
  transactionId: string;
  type: TransactionType;
  merchantName: string | null;
  amount: number;
  createdAt: string;
}

export interface PaymentResult {
  paymentId: string;
  amount: number | string;
  resolvedAmount: number;
  createdAt: string;
}

export interface Statement {
  statementId: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  minimumPaymentDue: number;
  dueDate: string;
  createdAt: string;
}

export interface StatementDetail extends Statement {
  transactions: Transaction[];
}

const PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  readonly pageSize = PAGE_SIZE;

  getAccount(accountId: string): Observable<Account> {
    return this.http
      .get<{ data: Account }>(`${this.base}/accounts/${accountId}`)
      .pipe(map((r) => r.data));
  }

  getTransactions(accountId: string, cursor?: string): Observable<Transaction[]> {
    const url = `${this.base}/accounts/${accountId}/transactions`;
    const req = cursor
      ? this.http.get<{ data: Transaction[] }>(url, { params: { cursor } })
      : this.http.get<{ data: Transaction[] }>(url);
    return req.pipe(map((r) => r.data));
  }

  postPayment(
    accountId: string,
    amount: number | 'FULL',
    idempotencyKey: string,
  ): Observable<PaymentResult> {
    return this.http
      .post<{ data: PaymentResult }>(`${this.base}/accounts/${accountId}/payments`, {
        amount,
        idempotencyKey,
      })
      .pipe(map((r) => r.data));
  }

  getStatements(accountId: string): Observable<Statement[]> {
    return this.http
      .get<{ data: Statement[] }>(`${this.base}/accounts/${accountId}/statements`)
      .pipe(map((r) => r.data));
  }

  getStatement(accountId: string, statementId: string): Observable<StatementDetail> {
    return this.http
      .get<{ data: StatementDetail }>(
        `${this.base}/accounts/${accountId}/statements/${statementId}`,
      )
      .pipe(map((r) => r.data));
  }

  generateStatement(accountId: string): Observable<Statement> {
    return this.http
      .post<{ data: Statement }>(`${this.base}/accounts/${accountId}/statements`, {})
      .pipe(map((r) => r.data));
  }
}
