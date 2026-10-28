import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {ErpApiService} from './erp-api.service';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  nationalId?: string;
  roleId: string;
  department?: string;
  status: string;
  createdAt: string;
}

interface LoginResponse {
  token: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
}

const TOKEN_KEY = 'mermelada-token';

/**
 * Session state for the ERP.
 *
 * When the API reports `authEnabled=false` (demo/local mode) no login is
 * required and the existing role simulator keeps working. In production the
 * app requires a valid JWT before rendering any module.
 */
@Injectable({providedIn: 'root'})
export class AuthService {
  private http = inject(HttpClient);
  private erp = inject(ErpApiService);

  public authEnabled = signal<boolean>(false);
  public ready = signal<boolean>(false);
  public currentUser = signal<AuthUser | null>(null);
  public token = signal<string | null>(null);

  public requiresLogin = computed(
    () => this.ready() && this.authEnabled() && !this.currentUser()
  );

  public getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY) || this.token();
  }

  /** Resolve whether authentication is enabled and restore the session. */
  public async initialize(): Promise<void> {
    if (typeof window === 'undefined') {
      this.ready.set(true);
      return;
    }

    try {
      const health = await firstValueFrom(
        this.http.get<{authEnabled?: boolean}>('/api/health')
      );
      this.authEnabled.set(Boolean(health?.authEnabled));
    } catch {
      this.authEnabled.set(false);
    }

    const stored = localStorage.getItem(TOKEN_KEY);
    if (this.authEnabled() && stored) {
      this.token.set(stored);
      try {
        const user = await firstValueFrom(
          this.http.get<AuthUser>('/api/auth/me')
        );
        this.applyUser(user);
      } catch {
        this.clearSession();
      }
    } else if (!this.authEnabled()) {
      // Demo mode: make sure the API sends a role header for admin-only rules.
      const role = localStorage.getItem('mermelada-demo-role') || 'admin';
      localStorage.setItem('mermelada-demo-role', role);
    }

    this.ready.set(true);
  }

  public async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', {username, password})
    );
    if (typeof window !== 'undefined' && res.token) {
      localStorage.setItem(TOKEN_KEY, res.token);
    }
    this.token.set(res.token);
    this.applyUser(res.user);
    await this.erp.refreshAllData();
  }

  public async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // Stateless tokens: ignoring the call is safe.
    }
    this.clearSession();
  }

  public async requestPasswordReset(identifier: string): Promise<{
    message: string;
    devToken?: string;
  }> {
    return firstValueFrom(
      this.http.post<{message: string; devToken?: string}>(
        '/api/auth/reset-password',
        {identifier}
      )
    );
  }

  public async confirmPasswordReset(
    token: string,
    newPassword: string
  ): Promise<{message: string}> {
    return firstValueFrom(
      this.http.post<{message: string}>('/api/auth/reset-password/confirm', {
        token,
        newPassword,
      })
    );
  }

  private applyUser(user: AuthUser): void {
    this.currentUser.set(user);
    this.erp.applyAuthenticatedRole(user.roleId, user.fullName);
  }

  private clearSession(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
    }
    this.token.set(null);
    this.currentUser.set(null);
  }
}
