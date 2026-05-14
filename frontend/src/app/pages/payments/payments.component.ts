import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { AccountService, PaymentResult } from '../../services/account.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';

@Component({
  selector: 'app-payments',
  imports: [CommonModule, CurrencyPipe, ReactiveFormsModule, NavbarComponent],
  templateUrl: './payments.component.html',
})
export class PaymentsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private accountId = '';

  protected readonly fb = inject(FormBuilder);
  protected readonly form = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    payFull: [false],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly confirmation = signal<PaymentResult | null>(null);
  protected readonly currentBalance = signal(0);

  ngOnInit(): void {
    this.accountId = this.auth.getAccountId() ?? '';
    this.accountService.getAccount(this.accountId).subscribe({
      next: (acc) => this.currentBalance.set(acc.currentBalance),
    });

    this.form.controls.payFull.valueChanges.subscribe((full) => {
      const amountCtrl = this.form.controls.amount;
      if (full) {
        amountCtrl.disable();
      } else {
        amountCtrl.enable();
      }
    });
  }

  protected get isFullBalance(): boolean {
    return this.form.controls.payFull.value;
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const payFull = this.form.controls.payFull.value;
    if (!payFull && this.form.controls.amount.invalid) return;
    if (this.loading()) return;

    this.errorMessage.set('');
    this.confirmation.set(null);
    this.loading.set(true);

    const amount: number | 'FULL' = payFull ? 'FULL' : Number(this.form.controls.amount.value);
    const idempotencyKey = crypto.randomUUID();

    this.accountService.postPayment(this.accountId, amount, idempotencyKey).subscribe({
      next: (result) => {
        this.loading.set(false);
        this.confirmation.set(result);
        this.form.reset({ amount: 0, payFull: false });
        this.form.controls.amount.enable();
        this.accountService.getAccount(this.accountId).subscribe({
          next: (acc) => this.currentBalance.set(acc.currentBalance),
        });
      },
      error: (err) => {
        this.loading.set(false);
        const msg: string = err?.error?.error?.message ?? 'Payment failed. Please try again.';
        this.errorMessage.set(msg);
      },
    });
  }
}
