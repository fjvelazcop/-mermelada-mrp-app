import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installGracefulShutdown,
  type LifecycleLogger,
  type SignalSource,
} from './lifecycle.js';

function fakeSignals(): SignalSource & EventEmitter {
  return new EventEmitter() as SignalSource & EventEmitter;
}

function fakeServer(
  behavior: 'ok' | 'error' | 'throw' = 'ok'
): Pick<Server, 'close'> & { closeIdleConnections: () => void } {
  return {
    closeIdleConnections: vi.fn(),
    close(callback?: (error?: Error | null) => void) {
      if (behavior === 'throw') {
        throw new Error('close exploded');
      }
      callback?.(behavior === 'error' ? new Error('close failed') : null);
      return this as unknown as Server;
    },
  };
}

function logger(): LifecycleLogger {
  return { log: vi.fn(), error: vi.fn() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('installGracefulShutdown', () => {
  it('drains the server, releases resources and exits with code 0 on SIGTERM', () => {
    const signals = fakeSignals();
    const server = fakeServer();
    const exit = vi.fn();
    const onClose = vi.fn();
    const log = logger();

    installGracefulShutdown({
      server,
      onClose,
      exit,
      signals,
      logger: log,
    });

    signals.emit('SIGTERM');

    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(log.log).toHaveBeenCalledWith(
      '[shutdown] SIGTERM received, draining connections...'
    );
  });

  it('supports SIGINT and ignores repeated signals', () => {
    const signals = fakeSignals();
    const server = fakeServer();
    const exit = vi.fn();

    const shutdown = installGracefulShutdown({
      server,
      exit,
      signals,
      logger: logger(),
    });

    signals.emit('SIGINT');
    shutdown('SIGTERM');
    signals.emit('SIGTERM');

    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits with code 1 when the HTTP server close fails', () => {
    const signals = fakeSignals();
    const exit = vi.fn();
    const log = logger();

    installGracefulShutdown({
      server: fakeServer('error'),
      exit,
      signals,
      logger: log,
    });

    signals.emit('SIGTERM');

    expect(exit).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledWith(
      '[shutdown] HTTP server close failed: close failed'
    );
  });

  it('exits with code 1 when a resource cannot be released', () => {
    const signals = fakeSignals();
    const exit = vi.fn();
    const log = logger();

    installGracefulShutdown({
      server: fakeServer(),
      onClose: () => {
        throw new Error('database busy');
      },
      exit,
      signals,
      logger: log,
    });

    signals.emit('SIGTERM');

    expect(exit).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledWith(
      '[shutdown] Failed to release resources: database busy'
    );
  });

  it('exits with code 1 if server.close throws synchronously', () => {
    const signals = fakeSignals();
    const exit = vi.fn();

    installGracefulShutdown({
      server: fakeServer('throw'),
      exit,
      signals,
      logger: logger(),
    });

    signals.emit('SIGTERM');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit when draining exceeds the timeout', () => {
    vi.useFakeTimers();
    const signals = fakeSignals();
    const exit = vi.fn();
    const log = logger();
    const server: Pick<Server, 'close'> = {
      close: vi.fn(), // never calls back: simulate a hung request
    };

    installGracefulShutdown({
      server,
      timeoutMs: 500,
      exit,
      signals,
      logger: log,
    });

    signals.emit('SIGTERM');
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(exit).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledWith(
      '[shutdown] Timed out after 500ms, forcing exit.'
    );
  });
});
