import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';

function exactlyFiveDigits(control: AbstractControl): ValidationErrors | null {
  const val = control.value as string;
  return /^\d{5}$/.test(val ?? '') ? null : { fiveDigits: true };
}

@Component({
  selector: 'app-apply',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './apply.component.html',
})
export class ApplyComponent {
  private readonly fb = inject(FormBuilder);
  private readonly appService = inject(ApplicationService);
  private readonly router = inject(Router);

  protected readonly form = this.fb.nonNullable.group({
    firstName:    ['', Validators.required],
    lastName:     ['', Validators.required],
    email:        ['', [Validators.required, Validators.email]],
    dateOfBirth:  ['', Validators.required],
    annualIncome: [0,  [Validators.required, Validators.min(0)]],
    mockSsn:      ['', [Validators.required, exactlyFiveDigits]],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) return;
    this.errorMessage.set('');
    this.loading.set(true);

    const raw = this.form.getRawValue();
    this.appService.submitApplication({ ...raw, annualIncome: Number(raw.annualIncome) }).subscribe({
      next: ({ applicationId }) => {
        this.loading.set(false);
        this.router.navigate(['/apply/confirmation'], { state: { applicationId } });
      },
      error: (err) => {
        this.loading.set(false);
        const msg: string = err?.error?.error?.message ?? 'Submission failed. Please try again.';
        this.errorMessage.set(msg);
      },
    });
  }
}
