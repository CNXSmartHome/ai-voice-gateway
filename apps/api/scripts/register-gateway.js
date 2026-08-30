#!/usr/bin/env node
/**
 * Records a manufactured gateway, so there is something for a customer to
 * claim (VG-005).
 *
 * Manufacturing intake, not a customer action, which is why it is a script
 * and not an HTTP endpoint: exposing it would need an operator role and an
 * admin authorization surface the API does not have yet. Anyone running this
 * already holds the database credentials.
 *
 * Usage:
 *   node scripts/register-gateway.js <serial-number> [name]
 *
 * Requires DATABASE_URL. Idempotent enough to be safe to retry: a serial
 * that already exists is reported and exits non-zero without touching the
 * existing row, so re-running a batch cannot reset a claimed gateway.
 */
const { PrismaClient } = require('@prisma/client');

const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

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

  const prisma = new PrismaClient();
  try {
    const gateway = await prisma.gateway.create({
      data: { serialNumber, name: name || serialNumber },
      select: { id: true, serialNumber: true, name: true, status: true },
    });

    console.log(
      `Registered ${gateway.serialNumber} as ${gateway.id} (${gateway.status}), named "${gateway.name}".`,
    );
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
