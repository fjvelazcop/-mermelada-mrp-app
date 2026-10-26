import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { createApiApp } from './server/api.js';
import { closeDb } from './server/database/persistence.js';
import { installGracefulShutdown } from './server/lifecycle.js';

const browserDistFolder = join(import.meta.dirname, '../browser');

/**
 * Hosts allowed by Angular SSR. Without an allow-list Angular renders only
 * the client-side shell, which breaks SEO and first paint in production.
 *
 * Priority: NG_ALLOWED_HOSTS -> hostname from APP_URL -> loopback only.
 * Never default to "*": configure the real domain in production.
 */
function resolveAllowedHosts(): string[] {
  const configured = process.env['NG_ALLOWED_HOSTS']
    ?.split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  if (configured?.length) return configured;

  try {
    const host = new URL(process.env['APP_URL'] || '').hostname;
    if (host) return [host];
  } catch {
    // APP_URL is optional or not a valid absolute URL.
  }

  return ['localhost', '127.0.0.1'];
}

const app = createApiApp();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: resolveAllowedHosts(),
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next()
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the host/port defined by the `HOST` and `PORT`
 * environment variables, defaulting to 0.0.0.0:4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT'] || 4000);
  const host = process.env['HOST'] || '0.0.0.0';
  const environment = process.env['NODE_ENV'] || 'development';

  const server = app.listen(port, host, (error) => {
    if (error) {
      throw error;
    }

    console.log(
      `[startup] Mermelada ERP listening on http://${host}:${port} (env=${environment})`
    );
  });

  // Docker, systemd and PM2 stop/restart the process with SIGTERM. Drain the
  // HTTP server and close SQLite cleanly so the supervisor can restart safely.
  installGracefulShutdown({ server, onClose: closeDb });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

export { app };
