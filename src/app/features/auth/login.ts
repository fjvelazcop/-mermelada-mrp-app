import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {AuthService} from '../../core/services/auth.service';

type AuthMode = 'login' | 'request' | 'confirm';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  public mode = signal<AuthMode>('login');
  public username = '';
  public password = '';
  public identifier = '';
  public resetToken = '';
  public newPassword = '';
  public confirmPassword = '';
  public devToken = signal<string | null>(null);
  public message = signal<string>('');
  public error = signal<string>('');
  public isLoading = signal<boolean>(false);

  public async onLogin(): Promise<void> {
    this.error.set('');
    if (!this.username.trim() || !this.password) {
      this.error.set('Ingresa tu usuario y contraseña.');
      return;
    }

    this.isLoading.set(true);
    try {
      await this.auth.login(this.username.trim(), this.password);
      this.password = '';
    } catch (err: unknown) {
      this.error.set(this.extractError(err, 'Usuario o contraseña incorrectos'));
    } finally {
      this.isLoading.set(false);
    }
  }

  public async onRequestReset(): Promise<void> {
    this.error.set('');
    this.message.set('');
    if (!this.identifier.trim()) {
      this.error.set('Ingresa tu usuario o correo electrónico.');
      return;
    }

    this.isLoading.set(true);
    try {
      const res = await this.auth.requestPasswordReset(this.identifier.trim());
      this.message.set(res.message);
      if (res.devToken) {
        this.devToken.set(res.devToken);
        this.resetToken = res.devToken;
      }
      this.mode.set('confirm');
    } catch (err: unknown) {
      this.error.set(this.extractError(err, 'No se pudo solicitar la recuperación'));
    } finally {
      this.isLoading.set(false);
    }
  }

  public async onConfirmReset(): Promise<void> {
    this.error.set('');
    if (!this.resetToken.trim()) {
      this.error.set('Ingresa el código de recuperación.');
      return;
    }
    if (this.newPassword.length < 8) {
      this.error.set('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }

    this.isLoading.set(true);
    try {
      const res = await this.auth.confirmPasswordReset(
        this.resetToken.trim(),
        this.newPassword
      );
      this.message.set(res.message);
      this.newPassword = '';
      this.confirmPassword = '';
      this.resetToken = '';
      this.devToken.set(null);
      this.mode.set('login');
    } catch (err: unknown) {
      this.error.set(this.extractError(err, 'El enlace es inválido o expiró'));
    } finally {
      this.isLoading.set(false);
    }
  }

  public showLogin(): void {
    this.mode.set('login');
    this.error.set('');
    this.message.set('');
  }

  public showRequest(): void {
    this.mode.set('request');
    this.error.set('');
    this.message.set('');
  }

  public showConfirm(): void {
    this.mode.set('confirm');
    this.error.set('');
  }

  public async onKeyDown(event: Event): Promise<void> {
    if ((event as KeyboardEvent).key !== 'Enter') return;
    if (this.mode() === 'login') await this.onLogin();
    if (this.mode() === 'request') await this.onRequestReset();
    if (this.mode() === 'confirm') await this.onConfirmReset();
  }

  private extractError(err: unknown, fallback: string): string {
    const anyErr = err as {
      error?: {error?: string; message?: string};
      message?: string;
    };
    return (
      anyErr?.error?.error ||
      anyErr?.error?.message ||
      (typeof anyErr?.message === 'string' && !anyErr.message.startsWith('Http failure')
        ? anyErr.message
        : fallback)
    );
  }
}
