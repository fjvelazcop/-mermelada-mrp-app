import { describe, expect, it } from 'vitest';
import {
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  buildResetLink,
  isLocalAppUrl,
  resolveAppUrl,
  resolvePublicAppUrl,
} from './auth-emails.js';

const user = {
  username: 'admin',
  fullName: 'Ana <Admin> & Co',
  email: 'admin@pulpacraft.local',
};

describe('auth email templates', () => {
  it('resolves the application URL without a trailing slash', () => {
    expect(resolveAppUrl({ APP_URL: 'https://erp.example.com/' })).toBe(
      'https://erp.example.com'
    );
    expect(resolveAppUrl({ APP_URL: '   ' })).toBe('http://localhost:4000');
  });

  it('keeps the reset token in the URL fragment and encodes it', () => {
    const link = buildResetLink('abc 123/xyz', 'https://erp.example.com/');
    expect(link).toBe(
      'https://erp.example.com/login#reset=abc%20123%2Fxyz'
    );
  });

  it('uses the request origin when APP_URL is local or empty', () => {
    expect(isLocalAppUrl('http://localhost:4000')).toBe(true);
    expect(isLocalAppUrl('http://127.0.0.1:4000')).toBe(true);
    expect(isLocalAppUrl('not-a-url')).toBe(true);
    expect(isLocalAppUrl('https://erp.example.com')).toBe(false);

    expect(
      resolvePublicAppUrl({
        env: { APP_URL: 'http://localhost:4000' },
        requestOrigin: 'https://erp.trycloudflare.com/',
      })
    ).toBe('https://erp.trycloudflare.com');

    expect(
      resolvePublicAppUrl({
        env: { APP_URL: 'https://erp.example.com/' },
        requestOrigin: 'https://ignored.example.com',
      })
    ).toBe('https://erp.example.com');

    expect(
      resolvePublicAppUrl({
        env: { APP_URL: '' },
      })
    ).toBe('http://localhost:4000');
  });

  it('builds a reset email with link, code, TTL and escaped HTML', () => {
    const email = buildPasswordResetEmail({
      user,
      token: 'token-123',
      ttlSeconds: 120,
      appUrl: 'https://erp.example.com',
    });

    expect(email.subject).toContain('Recuperación de contraseña');
    expect(email.text).toContain(
      'https://erp.example.com/login#reset=token-123'
    );
    expect(email.text).toContain('token-123');
    expect(email.text).toContain('2 minuto(s)');
    expect(email.html).toContain(
      'href="https://erp.example.com/login#reset=token-123"'
    );
    expect(email.html).toContain('Ana &lt;Admin&gt; &amp; Co');
    expect(email.html).not.toContain('Ana <Admin>');
  });

  it('builds the password-changed security notice', () => {
    const email = buildPasswordChangedEmail({
      user,
      changedAt: new Date('2026-11-18T15:00:00.000Z'),
    });

    expect(email.subject).toContain('contraseña fue cambiada');
    expect(email.text).toContain('admin');
    expect(email.text).toContain('Si no fuiste tú');
    expect(email.html).toContain('Contraseña actualizada');
    expect(email.html).toContain('Ana &lt;Admin&gt; &amp; Co');
  });
});
