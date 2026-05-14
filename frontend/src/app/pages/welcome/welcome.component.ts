import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-welcome',
  imports: [RouterLink],
  templateUrl: './welcome.component.html',
})
export class WelcomeComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  protected readonly year = new Date().getFullYear();
  protected readonly showFarewell = signal(false);

  ngOnInit(): void {
    const farewell = this.route.snapshot.queryParamMap.get('farewell');
    if (farewell === '1') {
      this.showFarewell.set(true);
    }
  }
}
