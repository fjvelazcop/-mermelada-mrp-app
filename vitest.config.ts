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
  },
});
