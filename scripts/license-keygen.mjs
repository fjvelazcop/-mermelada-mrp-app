#!/usr/bin/env node
/**
 * Generate the Ed25519 key pair used to sign system-license tokens.
 *
 * The private key must stay on the licensor's machine (or an encrypted backup),
 * never on the ERP server. Only `license-public.pem` is configured in
 * `LICENSE_PUBLIC_KEY_PATH`.
 *
 * Usage:
 *   node scripts/license-keygen.mjs [--out ./keys] [--force]
 */

import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const outDir = resolve(readArg('out', './keys'));
const force = process.argv.includes('--force');
const privatePath = join(outDir, 'license-private.pem');
const publicPath = join(outDir, 'license-public.pem');

if (!force && (existsSync(privatePath) || existsSync(publicPath))) {
  console.error(
    `Ya existe un par de claves en ${outDir}. Use --force para reemplazarlo (perderá la capacidad de renovar licencias emitidas con la clave anterior).`
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true, mode: 0o700 });

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

writeFileSync(privatePath, privatePem, { mode: 0o600 });
writeFileSync(publicPath, publicPem, { mode: 0o644 });
chmodSync(privatePath, 0o600);
chmodSync(publicPath, 0o644);

console.log('Par de claves Ed25519 generado');
console.log(`  Privada: ${privatePath}  (permisos 600, NO copiar al servidor)`);
console.log(`  Pública: ${publicPath}  (copiar al servidor)`);
console.log('');
console.log('Siguiente paso:');
console.log(
  `  scp "${publicPath}" mermelada-erp:/ruta/app/keys/license-public.pem`
);
console.log('');
console.log('Respalde la clave privada en un medio cifrado. Sin ella no podrá emitir');
console.log('tokens nuevos; habrá que rotar el par y actualizar el servidor.');
