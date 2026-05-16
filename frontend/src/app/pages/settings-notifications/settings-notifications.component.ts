import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SettingsService, NotificationPreferences } from '../../services/settings.service';

type PrefKey = keyof NotificationPreferences;

@Component({
  selector: 'app-settings-notifications',
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './settings-notifications.component.html',
})
export class SettingsNotificationsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private accountId = '';

  protected readonly prefs = signal<NotificationPreferences | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');

  // Per-toggle pending state — disables that toggle while its PATCH is in-flight
  protected readonly pending = signal<Record<PrefKey, boolean>>({
    transactionsEnabled: false,
    statementsEnabled: false,
    paymentRemindersEnabled: false,
  });

  ngOnInit(): void {
    this.accountId = this.auth.getAccountId() ?? '';
    this.settings.getNotificationPreferences(this.accountId).subscribe({
      next: (p) => {
        this.prefs.set(p);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Unable to load notification preferences.');
        this.loading.set(false);
      },
    });
  }

  protected toggle(key: PrefKey, newValue: boolean): void {
    const current = this.prefs();
    if (!current || this.pending()[key]) return;

    // Optimistic update
    this.prefs.set({ ...current, [key]: newValue });
    this.pending.update((p) => ({ ...p, [key]: true }));

    this.settings.updateNotificationPreferences(this.accountId, { [key]: newValue }).subscribe({
      next: (updated) => {
        this.prefs.set(updated);
        this.pending.update((p) => ({ ...p, [key]: false }));
      },
      error: () => {
        // Revert
        this.prefs.set({ ...this.prefs()!, [key]: !newValue });
        this.pending.update((p) => ({ ...p, [key]: false }));
        this.errorMessage.set('Failed to update preference. Please try again.');
      },
    });
  }
}
