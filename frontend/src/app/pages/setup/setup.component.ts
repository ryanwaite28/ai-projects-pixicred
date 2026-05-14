import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value as string;
  const confirm = control.get('confirmPassword')?.value as string;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-setup',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './setup.component.html',
})
export class SetupComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      accountId: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordMatchValidator },
  );

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) return;
    this.errorMessage.set('');
    this.loading.set(true);

    const { email, accountId, password } = this.form.getRawValue();
    this.auth.register(email, accountId, password).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/login'], { state: { registered: true } });
      },
      error: (err) => {
        this.loading.set(false);
        const msg: string =
          err?.error?.error?.message ?? 'Registration failed. Please try again.';
        this.errorMessage.set(msg);
      },
    });
  }
}
