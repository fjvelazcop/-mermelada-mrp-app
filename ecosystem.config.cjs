/**
 * PM2 process supervisor for the Angular SSR + Express server.
 *
 * Start with the production env loaded:
 *   set -a && . ./.env.production && set +a
 *   pm2 start ecosystem.config.cjs --update-env
 *
 * PM2 restarts the process on crashes and after the configured memory limit.
 * SIGTERM is handled by src/server.ts (graceful drain + SQLite close).
 */
module.exports = {
  apps: [
    {
      name: 'mermelada-erp',
      script: 'dist/app/server/server.mjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      time: true,
      merge_logs: true,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4000',
        DB_PATH: './data/mermelada.db',
      },
    },
    ...(process.env.TUNNEL_ENABLED === 'true'
      ? [
          {
            name: 'mermelada-tunnel',
            script: 'scripts/tunnel.mjs',
            interpreter: 'node',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_restarts: 20,
            min_uptime: '15s',
            restart_delay: 5000,
            exp_backoff_restart_delay: 500,
            kill_timeout: 12000,
            time: true,
            merge_logs: true,
            out_file: './logs/tunnel-out.log',
            error_file: './logs/tunnel-error.log',
            env: {
              NODE_ENV: 'production',
              PORT: '4000',
              TUNNEL_ENABLED: 'true',
              TUNNEL_MODE: process.env.TUNNEL_MODE || 'quick',
            },
          },
        ]
      : []),
  ],
};
