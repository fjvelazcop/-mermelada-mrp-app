/**
 * PM2 process supervisor for the Angular SSR + Express server.
 *
 * Environment loading:
 *   ENV_FILE=.env.custom  -> explicit file
 *   .env.production       -> used when it exists (Docker/systemd style)
 *   .env                  -> local fallback
 *
 * Variables already exported in the shell always win over the file, so
 * `set -a && . ./.env.production && set +a` keeps working.
 *
 * Start with:
 *   pm2 start ecosystem.config.cjs --update-env
 *
 * PM2 restarts the process on crashes and after the configured memory limit.
 * SIGTERM is handled by src/server.ts (graceful drain + SQLite close).
 */
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;

/** Minimal .env parser: KEY=value, optional `export`, quotes and comments. */
function loadEnvFile() {
  const candidates = process.env.ENV_FILE
    ? [join(ROOT, process.env.ENV_FILE)]
    : [join(ROOT, '.env.production'), join(ROOT, '.env')];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return { file: null, values: {} };

  const values = {};
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return { file, values };
}

const envFile = loadEnvFile();

/** File values that the operator did not already export in the shell. */
const fileOnlyEnv = Object.fromEntries(
  Object.entries(envFile.values).filter(
    ([key]) => process.env[key] === undefined
  )
);

const configValue = (key, fallback) =>
  process.env[key] ?? envFile.values[key] ?? fallback;

// PM2 runs the compiled server, so production is the safe default. The port
// and DB path can be overridden from the env file.
const appEnv = {
  ...fileOnlyEnv,
  NODE_ENV: 'production',
  HOST: configValue('HOST', '127.0.0.1'),
  PORT: configValue('PORT', '4000'),
  DB_PATH: configValue('DB_PATH', './data/mermelada.db'),
};

const tunnelEnabled = configValue('TUNNEL_ENABLED', 'false') === 'true';

mkdirSync(join(ROOT, 'logs'), { recursive: true });

module.exports = {
  apps: [
    {
      name: 'mermelada-erp',
      script: 'dist/app/server/server.mjs',
      cwd: ROOT,
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
      env: appEnv,
    },
    ...(tunnelEnabled
      ? [
          {
            name: 'mermelada-tunnel',
            script: 'scripts/tunnel.mjs',
            interpreter: 'node',
            cwd: ROOT,
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
              ...appEnv,
              TUNNEL_ENABLED: 'true',
              TUNNEL_MODE: configValue('TUNNEL_MODE', 'quick'),
            },
          },
        ]
      : []),
  ],
};
