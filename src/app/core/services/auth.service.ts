import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Router} from '@angular/router';
import {firstValueFrom, timeout} from 'rxjs';
import {ErpApiService} from './erp-api.service';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  nationalId?: string;
  roleId: string;
  roleName?: string;
  department?: string;
  status: string;
  createdAt: string;
  avatarBg?: string;
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
 * The UI always requires a user session. In demo/local mode the API can still
 * accept unauthenticated requests for development role simulation.
 */
@Injectable({providedIn: 'root'})
export class AuthService {
  private http = inject(HttpClient);
  private erp = inject(ErpApiService);
  private router = inject(Router);
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  public authEnabled = signal<boolean>(false);
  public ready = signal<boolean>(false);
  public initializationError = signal<string | null>(null);
  public currentUser = signal<AuthUser | null>(null);
  public token = signal<string | null>(null);

  public requiresLogin = computed(
    () => this.ready() && !this.currentUser()
  );

  public getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY) || this.token();
  }

  /** Resolve whether authentication is enabled and restore the session. */
  public async initialize(): Promise<void> {
    this.ready.set(false);
    this.initializationError.set(null);

    if (typeof window === 'undefined') {
      this.ready.set(true);
      return;
    }

    try {
      const health = await firstValueFrom(
        this.http
          .get<{authEnabled?: boolean}>('/api/health')
          .pipe(timeout({first: 8000}))
      );
      if (typeof health?.authEnabled !== 'boolean') {
        throw new Error('La respuesta de salud no contiene authEnabled');
      }
      this.authEnabled.set(health.authEnabled);
    } catch {
      // Unknown auth state must not expose the demo UI against a protected API.
      this.authEnabled.set(true);
      this.initializationError.set(
        'No se pudo verificar el servidor. El acceso sigue protegido; revisa la conexión e inténtalo de nuevo.'
      );
    }

    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      this.token.set(stored);
      try {
        const user = await firstValueFrom(
          this.http
            .get<AuthUser>('/api/auth/me')
            .pipe(timeout({first: 8000}))
        );
        await this.erp.refreshSecurityData();
        this.applyUser(user);
        this.scheduleExpiry(stored);
        this.initializationError.set(null);
      } catch {
        this.clearSession();
        if (!this.initializationError()) {
          this.initializationError.set(
            'La sesión expiró o no es válida. Inicia sesión nuevamente.'
          );
        }
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
    this.scheduleExpiry(res.token);
    await this.erp.refreshSecurityData();
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
    await this.router.navigateByUrl('/login', {replaceUrl: true});
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

  /**
   * Change the password of the authenticated user. The backend invalidates the
   * current token, so the local session is cleared and login is required again.
   */
  public async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{message: string; requiresLogin: boolean}> {
    const response = await firstValueFrom(
      this.http.post<{message: string; requiresLogin: boolean}>(
        '/api/auth/change-password',
        {currentPassword, newPassword}
      )
    );
    this.clearSession();
    await this.router.navigateByUrl('/login', {replaceUrl: true});
    return response;
  }

  private applyUser(user: AuthUser): void {
    this.currentUser.set(user);
    this.erp.applyAuthenticatedUser(user);
  }

  private clearSession(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
    }
    this.token.set(null);
    this.currentUser.set(null);
    this.erp.clearAuthenticatedUser();
  }

  private scheduleExpiry(token: string): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
    }

    try {
      const encodedPayload = token.split('.')[0];
      if (!encodedPayload) {
        throw new Error('El token no contiene un payload');
      }
      const normalizedPayload = encodedPayload
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const paddedPayload =
        normalizedPayload + '='.repeat((4 - (normalizedPayload.length % 4)) % 4);
      const decodedPayload = atob(paddedPayload);
      const payloadText = new TextDecoder().decode(
        Uint8Array.from(decodedPayload, character => character.charCodeAt(0))
      );
      const payload = JSON.parse(payloadText) as {exp?: unknown};
      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
        throw new Error('El token no contiene una fecha de expiración válida');
      }

      const expiresAt = payload.exp * 1000;
      const expire = () => {
        const remaining = expiresAt - Date.now();
        if (remaining > 0) {
          this.expiryTimer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
          return;
        }
        this.clearSession();
        this.initializationError.set(
          'La sesión expiró. Inicia sesión nuevamente.'
        );
        void this.router.navigateByUrl('/login', {replaceUrl: true});
      };
      expire();
    } catch (error) {
      this.clearSession();
      this.initializationError.set(
        'No se pudo validar la expiración de la sesión. Inicia sesión nuevamente.'
      );
      void this.router.navigateByUrl('/login', {replaceUrl: true});
      throw error;
    }
  }
}
