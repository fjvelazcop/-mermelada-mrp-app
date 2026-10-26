/**
 * CybersecurityAgent - Agent in charge of security‑related tasks:
 * input validation, vulnerability scanning, authentication/authorization checks,
 * and audit logging of security events.
 *
 * This agent can be invoked by the planner or other agents whenever
 * data enters the system or when sensitive operations are performed.
 */
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CybersecurityAgent {
  /** Validate that a string is not empty and does not contain suspicious patterns. */
  validateInput(value: string, allowList?: RegExp[]): { valid: boolean; reason?: string } {
    if (typeof value !== 'string' || value.length === 0) {
      return { valid: false, reason: 'Input must be a non‑empty string' };
    }
    // Disallow SQL injection like patterns
    if (/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b)/i.test(value)) {
      return { valid: false, reason: 'Potential SQL injection detected' };
    }
    // Disallow script tags
    if (/<script/i.test(value)) {
      return { valid: false, reason: 'Potential XSS script tag detected' };
    }
    // If an allowlist is provided, ensure the value matches at least one pattern
    if (allowList && allowList.length > 0) {
      const matched = allowList.some((re) => re.test(value));
      if (!matched) {
        return { valid: false, reason: 'Input does not match allowed patterns' };
      }
    }
    return { valid: true };
  }

  /** Simple XSS sanitization by stripping script tags and event handlers. */
  sanitizeHTML(value: string): string {
    return value
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/expression\s*\(/gi, '');
  }

  /** Check whether a user role is authorized to perform a given action. */
  isAuthorized(userRole: string, allowedRoles: string[]): boolean {
    return allowedRoles.includes(userRole);
  }

  /** Generate an audit log entry for a security event. */
  logSecurityEvent(event: {
    timestamp: string;
    module: string;
    action: string;
    userId?: string;
    details?: string;
  }): void {
    // In a real system this would write to a persistent audit log.
    console.log('[CybersecurityAudit]', event);
  }
}