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
    // getCurrentNavigation() is null for lazy-loaded components after the navigation
    // has resolved. Fall back to history.state, which Angular Router also populates
    // via the History API and persists after navigation completes.
    const navState = (this.router.getCurrentNavigation()?.extras?.state
      ?? history.state) as { applicationId?: string } | undefined;
    const id = navState?.applicationId;
    if (!id) {
      this.router.navigate(['/apply']);
      return;
    }
    this.applicationId.set(id);
  }
}
