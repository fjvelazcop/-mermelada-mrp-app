import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Server tests need a Node environment (SQLite, Express, Angular SSR).
    environment: 'node',
    include: ['src/server/**/*.spec.ts'],
    // Native modules (better-sqlite3) are safer in forked processes than in
    // worker threads.
    pool: 'forks',
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/server',
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/**/*.spec.ts', 'src/server/**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
