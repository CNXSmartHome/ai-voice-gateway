#!/usr/bin/env node
/**
 * Runs `prisma generate` with a placeholder DATABASE_URL when none is set.
 *
 * Code generation parses the datasource block but never opens a connection,
 * so it should not require a real database. Without this, `npm run build` on
 * a fresh clone fails before it compiles anything, and CI would need a
 * database just to typecheck.
 *
 * A real DATABASE_URL is still required to run the application or the
 * database integration tests; the placeholder points at nothing.
 *
 * The CLI is resolved to its JavaScript entry point and run with `node`
 * rather than spawned as `prisma`/`prisma.cmd`, because Node refuses to
 * spawn a `.cmd` shim without a shell on Windows.
 */
const { spawnSync } = require('node:child_process');
const { dirname, join, resolve } = require('node:path');

const PLACEHOLDER = 'postgresql://codegen:codegen@127.0.0.1:5432/codegen?schema=public';

function resolvePrismaCli() {
  const manifestPath = require.resolve('prisma/package.json');
  const manifest = require(manifestPath);
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.prisma;

  if (!bin) {
    throw new Error('Could not determine the prisma CLI entry point from its package manifest.');
  }
  return resolve(dirname(manifestPath), bin);
}

const env = { ...process.env };
if (!env.DATABASE_URL) {
  env.DATABASE_URL = PLACEHOLDER;
}

let cli;
try {
  cli = resolvePrismaCli();
} catch (error) {
  console.error(`Failed to locate the prisma CLI: ${error.message}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [cli, 'generate', '--schema', join(__dirname, '..', 'prisma', 'schema.prisma')],
  { stdio: 'inherit', env },
);

if (result.error) {
  console.error(`Failed to run prisma generate: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
