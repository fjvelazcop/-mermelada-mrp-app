/**
 * Extract the public URL from cloudflared's quick-tunnel output.
 *
 * cloudflared prints the real tunnel host inside a banner, but error lines can
 * also contain `https://api.trycloudflare.com` (the Cloudflare API endpoint).
 * Returning that host would register a bogus URL and make the ERP unreachable
 * through the tunnel, so reserved hosts are ignored.
 */

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
const RESERVED_HOSTS = new Set([
  'api.trycloudflare.com',
  'www.trycloudflare.com',
]);

/**
 * @param {string} chunk cloudflared stdout/stderr chunk (may contain many lines)
 * @returns {string} the first real quick-tunnel URL, or an empty string
 */
export function parseQuickTunnelUrl(chunk) {
  if (typeof chunk !== 'string' || chunk.length === 0) return '';

  const matches = chunk.match(URL_PATTERN) || [];
  for (const candidate of matches) {
    let host;
    try {
      host = new URL(candidate).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (RESERVED_HOSTS.has(host)) continue;
    return `https://${host}`;
  }
  return '';
}
