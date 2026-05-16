import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const publicGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (localStorage.getItem('pixicred_jwt')) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
