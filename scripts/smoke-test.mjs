#!/usr/bin/env node
/**
 * Post-deploy smoke test for a running instance.
 *
 * Environment variables:
 *  - SMOKE_BASE_URL     Target base URL (default: http://127.0.0.1:4000)
 *  - SMOKE_TIMEOUT_MS   Per-request timeout (default: 10000)
 */
const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 10_000);

const checks = [];
let failed = false;

async function check(name, path, validate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json, text/html' },
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    const detail = validate(response, body);

    checks.push({ name, ok: true, detail });
    console.log(`[smoke] PASS ${name}: ${detail}`);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, ok: false, detail: message });
    console.error(`[smoke] FAIL ${name}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

await check('health', '/api/health', (response, body) => {
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  if (body.status !== 'ok') throw new Error(`status=${body.status}`);
  if (body.database?.connected !== true) {
    throw new Error('database is not connected');
  }
  return `version=${body.version}`;
});

await check('openapi', '/api/openapi.json', (response, body) => {
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  if (!String(body.openapi || '').startsWith('3.')) {
    throw new Error('missing OpenAPI 3 document');
  }
  return `openapi=${body.openapi}`;
});

await check('frontend', '/', (response, body) => {
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  if (!String(body).includes('<app-root')) {
    throw new Error('Angular root element not found');
  }
  return 'Angular SSR HTML served';
});

if (failed) {
  console.error(
    `[smoke] ${checks.filter((check) => !check.ok).length} check(s) failed.`
  );
  process.exit(1);
}

console.log(`[smoke] All ${checks.length} checks passed against ${baseUrl}`);
