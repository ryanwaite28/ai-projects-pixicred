import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  template: `
    <footer style="background-color: var(--color-pxc-navy); border-top: 1px solid var(--color-pxc-navy-light)">
      <div class="max-w-5xl mx-auto px-6 py-6">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
          <span class="pxc-logo">Pixi<span>Cred</span></span>

          <div class="flex flex-wrap gap-x-6 gap-y-1 justify-center text-xs" style="color: #94a3b8">
            <a routerLink="/apply" class="hover:text-white transition-colors">Apply</a>
            <a routerLink="/apply/status" class="hover:text-white transition-colors">Check Status</a>
            <a routerLink="/login" class="hover:text-white transition-colors">Sign In</a>
            <a routerLink="/dashboard" class="hover:text-white transition-colors">Dashboard</a>
          </div>

          <p class="text-xs" style="color: #64748b">
            &copy; {{ year }} PixiCred. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  protected readonly year = new Date().getFullYear();
}
