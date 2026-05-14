import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const JWT_KEY = 'pixicred_jwt';

interface LoginResponse {
  data: { token: string; accountId: string };
}

interface RegisterResponse {
  data: { accountId: string };
}

interface JwtPayload {
  accountId: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.base}/auth/login`, { email, password })
      .pipe(tap((res) => this.storeToken(res.data.token)));
  }

  register(email: string, accountId: string, password: string): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.base}/auth/register`, {
      email,
      accountId,
      password,
    });
  }

  logout(): void {
    localStorage.removeItem(JWT_KEY);
  }

  isAuthenticated(): boolean {
    const payload = this.decodePayload();
    if (!payload) return false;
    return payload.exp * 1000 > Date.now();
  }

  getAccountId(): string | null {
    return this.decodePayload()?.accountId ?? null;
  }

  getEmail(): string | null {
    return this.decodePayload()?.email ?? null;
  }

  getToken(): string | null {
    return localStorage.getItem(JWT_KEY);
  }

  private storeToken(token: string): void {
    localStorage.setItem(JWT_KEY, token);
  }

  private decodePayload(): JwtPayload | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const raw = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(raw) as JwtPayload;
    } catch {
      return null;
    }
  }
}
