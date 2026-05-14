import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface NotificationPreferences {
  transactionsEnabled: boolean;
  statementsEnabled: boolean;
  paymentRemindersEnabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getNotificationPreferences(accountId: string): Observable<NotificationPreferences> {
    return this.http
      .get<{ data: NotificationPreferences }>(`${this.base}/accounts/${accountId}/notifications`)
      .pipe(map((r) => r.data));
  }

  updateNotificationPreferences(
    accountId: string,
    prefs: Partial<NotificationPreferences>,
  ): Observable<NotificationPreferences> {
    return this.http
      .patch<{ data: NotificationPreferences }>(
        `${this.base}/accounts/${accountId}/notifications`,
        prefs,
      )
      .pipe(map((r) => r.data));
  }

  closeAccount(accountId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.base}/accounts/${accountId}`)
      .pipe(map(() => void 0));
  }
}
