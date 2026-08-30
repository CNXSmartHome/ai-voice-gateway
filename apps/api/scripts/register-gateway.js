#!/usr/bin/env node
/**
 * Records a manufactured gateway and issues its device credential, so there
 * is something for a customer to claim (VG-005) and something the hardware
 * can authenticate with (VG-006).
 *
 * Manufacturing intake, not a customer action, which is why it is a script
 * and not an HTTP endpoint: exposing it would need an operator role and an
 * admin authorization surface the API does not have yet. Anyone running this
 * already holds the database credentials.
 *
 * Usage:
 *   node scripts/register-gateway.js <serial-number> [name]
 *
 * Requires DATABASE_URL. The gateway row and its credential are written in
 * one transaction, so a gateway can never exist without a way to connect.
 *
 * **The secret is printed once.** Only its hash is stored, so it cannot be
 * recovered afterwards -- flash it to the device now. A serial that already
 * exists is reported and exits non-zero without touching the existing row, so
 * re-running a batch cannot reset a claimed gateway or rotate a live secret.
 */
const { createHash, randomBytes } = require('node:crypto');

const { PrismaClient } = require('@prisma/client');

const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9-]{4,64}$/;
const SECRET_BYTES = 32;

/**
 * Must match `GatewaySecretService.hash`.
 *
 * Duplicated rather than imported because this script runs under plain node
 * against the compiled-free source tree. A drift test asserts the two agree.
 */
function hashSecret(secret) {
  return `sha256$v=1$${createHash('sha256').update(secret, 'utf8').digest('base64')}`;
}

async function main() {
  const [serialNumber, name] = process.argv.slice(2);

  if (!serialNumber) {
    console.error('Usage: node scripts/register-gateway.js <serial-number> [name]');
    process.exitCode = 2;
    return;
  }

  if (!SERIAL_NUMBER_PATTERN.test(serialNumber)) {
    console.error(
      `Invalid serial number: ${serialNumber}\n` +
        'Expected 4-64 characters of letters, digits, and hyphens.',
    );
    process.exitCode = 2;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 2;
    return;
  }

  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const prisma = new PrismaClient();

  try {
    const gateway = await prisma.gateway.create({
      data: {
        serialNumber,
        name: name || serialNumber,
        credential: { create: { secretHash: hashSecret(secret) } },
      },
      select: { id: true, serialNumber: true, name: true, status: true },
    });

    console.log(
      `Registered ${gateway.serialNumber} as ${gateway.id} (${gateway.status}), named "${gateway.name}".`,
    );
    console.log('');
    console.log('Device secret (shown once, not recoverable -- flash it to the device now):');
    console.log(`  ${secret}`);
    console.log('');
    console.log('The device authenticates with:');
    console.log(`  Authorization: Gateway ${gateway.serialNumber}:<secret>`);
  } catch (error) {
    // P2002 is the unique index on serial_number.
    if (error && error.code === 'P2002') {
      console.error(`Serial number ${serialNumber} is already registered; leaving it untouched.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to register gateway:', error.message);
  process.exitCode = 1;
});
