import { Component, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MerchantService } from '../../services/merchant.service';
import type { Transaction } from '../../services/account.service';

@Component({
  selector: 'app-merchant',
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './merchant.component.html',
  styleUrl: './merchant.component.css',
})
export class MerchantComponent {
  private readonly fb = inject(FormBuilder);
  private readonly merchantService = inject(MerchantService);

  protected readonly form = this.fb.nonNullable.group({
    cardNumber:   ['', [Validators.required, Validators.pattern(/^\d{16}$/)]],
    cardCvv:      ['', [Validators.required, Validators.pattern(/^\d{3}$/)]],
    merchantName: ['', [Validators.required, Validators.minLength(1)]],
    amount:       [null as unknown as number, [Validators.required, Validators.min(0.01)]],
  });

  protected readonly submitting        = signal(false);
  protected readonly charged           = signal(false);
  protected readonly errorMessage      = signal<string | null>(null);
  protected readonly chargedTransaction = signal<Transaction | null>(null);

  protected onSubmit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.errorMessage.set(null);

    const raw = this.form.getRawValue();
    this.merchantService.postMerchantCharge({
      cardNumber:     raw.cardNumber,
      cardCvv:        raw.cardCvv,
      merchantName:   raw.merchantName,
      amount:         Number(raw.amount),
      idempotencyKey: crypto.randomUUID(),
    }).subscribe({
      next: (txn) => {
        this.submitting.set(false);
        this.chargedTransaction.set(txn);
        this.charged.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        const msg: string = err?.error?.error?.message ?? 'Charge failed. Please try again.';
        this.errorMessage.set(msg);
      },
    });
  }

  protected reset(): void {
    this.charged.set(false);
    this.chargedTransaction.set(null);
    this.errorMessage.set(null);
    this.form.reset();
  }
}
