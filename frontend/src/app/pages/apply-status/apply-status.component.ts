import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ApplicationService,
  ApplicationStatus,
  ApplicationStatusResponse,
} from '../../services/application.service';

@Component({
  selector: 'app-apply-status',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './apply-status.component.html',
})
export class ApplyStatusComponent {
  private readonly fb = inject(FormBuilder);
  private readonly appService = inject(ApplicationService);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', Validators.required],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly result = signal<ApplicationStatusResponse | null>(null);

  protected check(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) return;
    this.errorMessage.set('');
    this.result.set(null);
    this.loading.set(true);

    const code = this.form.getRawValue().code.trim();
    this.appService.getApplicationStatus(code).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.result.set(res);
      },
      error: (err) => {
        this.loading.set(false);
        const msg: string =
          err?.error?.error?.message ?? 'Could not find that application. Check the code and try again.';
        this.errorMessage.set(msg);
      },
    });
  }

  protected isPending(s: ApplicationStatus): boolean   { return s === 'PENDING'; }
  protected isApproved(s: ApplicationStatus): boolean  { return s === 'APPROVED'; }
  protected isDeclined(s: ApplicationStatus): boolean  { return s === 'DECLINED'; }
}
