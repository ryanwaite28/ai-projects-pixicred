import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-apply-confirmation',
  imports: [RouterLink],
  templateUrl: './apply-confirmation.component.html',
})
export class ApplyConfirmationComponent implements OnInit {
  private readonly router = inject(Router);

  protected readonly applicationId = signal('');

  ngOnInit(): void {
    const state = this.router.getCurrentNavigation()?.extras?.state as
      | { applicationId?: string }
      | undefined;
    const id = state?.applicationId;
    if (!id) {
      this.router.navigate(['/apply']);
      return;
    }
    this.applicationId.set(id);
  }
}
