import type { Server } from 'node:http';

/** Minimal logger contract so the lifecycle can be tested without touching stdout. */
export interface LifecycleLogger {
  log(message: string): void;
  error(message: string): void;
}

/** Minimal signal source (Node's `process` by default). */
export interface SignalSource {
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

export interface GracefulShutdownOptions {
  /** HTTP server returned by `app.listen()`. */
  server: Pick<Server, 'close'>;
  /** Release resources (for example the SQLite connection) after the server closes. */
  onClose?: () => void;
  /** Maximum time to wait for in-flight requests before forcing exit. */
  timeoutMs?: number;
  /** Process exit function; defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Signal source; defaults to `process`. */
  signals?: SignalSource;
  /** Logger; defaults to the global console. */
  logger?: LifecycleLogger;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Install SIGTERM/SIGINT handlers that drain the HTTP server before exiting.
 *
 * Process supervisors (PM2, systemd, Docker) send SIGTERM when restarting or
 * stopping the app. Draining in-flight requests and closing SQLite cleanly
 * prevents truncated responses and orphaned `-wal`/`-shm` files.
 *
 * Returns the shutdown function so tests and tooling can trigger it directly.
 */
export function installGracefulShutdown({
  server,
  onClose,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  exit = (code) => process.exit(code),
  signals = process,
  logger = console,
}: GracefulShutdownOptions): (signal?: string) => void {
  let shuttingDown = false;

  const shutdown = (signal = 'SIGTERM'): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.log(`[shutdown] ${signal} received, draining connections...`);

    const timer = setTimeout(() => {
      logger.error(
        `[shutdown] Timed out after ${timeoutMs}ms, forcing exit.`
      );
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    const finish = (error?: Error | null): void => {
      clearTimeout(timer);

      let closeError: unknown;
      try {
        onClose?.();
      } catch (cause) {
        closeError = cause;
        logger.error(
          `[shutdown] Failed to release resources: ${
            cause instanceof Error ? cause.message : String(cause)
          }`
        );
      }

      if (error) {
        logger.error(`[shutdown] HTTP server close failed: ${error.message}`);
      }

      const code = error || closeError ? 1 : 0;
      logger.log(`[shutdown] Completed with exit code ${code}.`);
      exit(code);
    };

    try {
      server.close((error) => finish(error));
      // Stop accepting new keep-alive connections immediately; in-flight
      // requests still get a chance to finish.
      (server as Partial<Server>).closeIdleConnections?.();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  };

  signals.once('SIGTERM', () => shutdown('SIGTERM'));
  signals.once('SIGINT', () => shutdown('SIGINT'));

  return shutdown;
}
