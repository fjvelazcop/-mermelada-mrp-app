import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM helper used by the PM2 tunnel supervisor.
import { parseQuickTunnelUrl } from '../../scripts/tunnel-url.mjs';

describe('parseQuickTunnelUrl', () => {
  it('extracts the real URL from the cloudflared banner', () => {
    const output = [
      'INF Requesting new quick Tunnel on trycloudflare.com...',
      'INF |  https://owned-negotiation-distribute-oriented.trycloudflare.com  |',
    ].join('\n');

    expect(parseQuickTunnelUrl(output)).toBe(
      'https://owned-negotiation-distribute-oriented.trycloudflare.com'
    );
  });

  it('ignores the Cloudflare API host printed on error lines', () => {
    const output = [
      'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup failed',
      'INF |  https://scenarios-trek-acknowledged-carpet.trycloudflare.com  |',
    ].join('\n');

    expect(parseQuickTunnelUrl(output)).toBe(
      'https://scenarios-trek-acknowledged-carpet.trycloudflare.com'
    );
  });

  it('does not return reserved hosts when they are the only match', () => {
    expect(
      parseQuickTunnelUrl(
        'Post "https://api.trycloudflare.com/tunnel": temporary failure'
      )
    ).toBe('');
  });

  it('returns an empty string when there is no tunnel URL', () => {
    expect(parseQuickTunnelUrl('INF precheck complete')).toBe('');
    expect(parseQuickTunnelUrl('')).toBe('');
  });

  it('normalizes the host to lowercase', () => {
    expect(
      parseQuickTunnelUrl(
        'INF |  https://OWNED-NEGOTIATION-DISTRIBUTE-ORIENTED.trycloudflare.com  |'
      )
    ).toBe('https://owned-negotiation-distribute-oriented.trycloudflare.com');
  });
});
