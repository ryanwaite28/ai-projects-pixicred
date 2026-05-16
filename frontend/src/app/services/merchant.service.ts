import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type { Transaction } from './account.service';

export interface MerchantChargePayload {
  cardNumber:     string;
  cardCvv:        string;
  merchantName:   string;
  amount:         number;
  idempotencyKey: string;
}

@Injectable({ providedIn: 'root' })
export class MerchantService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  postMerchantCharge(payload: MerchantChargePayload): Observable<Transaction> {
    return this.http
      .post<{ data: Transaction }>(`${this.base}/merchant/charge`, payload)
      .pipe(map((r) => r.data));
  }
}
