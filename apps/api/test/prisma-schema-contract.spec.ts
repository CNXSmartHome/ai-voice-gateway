import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CAPABILITIES, DEVICE_TYPES, PLATFORMS } from '@vg/domain';

/**
 * The generated Prisma client is checked against the domain elsewhere. This
 * reads the schema *source*, so a schema edit that has not been regenerated
 * still fails here rather than passing against a stale client.
 */
const SCHEMA_PATH = join(__dirname, '..', 'prisma', 'schema.prisma');
const schema = readFileSync(SCHEMA_PATH, 'utf8');

/** Bare identifiers declared inside `enum <name> { ... }`. */
function enumValues(name: string): string[] {
  const match = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(schema);
  if (!match?.[1]) {
    throw new Error(`enum ${name} not found in schema.prisma`);
  }

  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

/** Fields declared inside `model <name> { ... }`, as name -> type. */
function modelFields(name: string): Record<string, string> {
  const match = new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!match?.[1]) {
    throw new Error(`model ${name} not found in schema.prisma`);
  }

  const fields: Record<string, string> = {};
  for (const raw of match[1].split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;
    const field = /^(\w+)\s+(\S+)/.exec(line);
    if (field?.[1] && field[2]) fields[field[1]] = field[2];
  }
  return fields;
}

/** True when a field's type is another model, i.e. a relation, not a column. */
function isRelation(type: string): boolean {
  const model = type.replace(/[?[\]]/g, '');

  return new RegExp(`model\\s+${model}\\s*\\{`).test(schema);
}

describe('schema.prisma enum parity with the domain model', () => {
  it('declares the same device types', () => {
    expect(
      enumValues('DeviceType')
        .map((v) => v.toLowerCase())
        .sort(),
    ).toEqual([...DEVICE_TYPES].sort());
  });

  it('declares the same platforms', () => {
    expect(
      enumValues('Platform')
        .map((v) => v.toLowerCase())
        .sort(),
    ).toEqual([...PLATFORMS].sort());
  });

  it('declares the same capabilities', () => {
    expect(
      enumValues('Capability')
        .map((v) => v.toLowerCase())
        .sort(),
    ).toEqual([...CAPABILITIES].sort());
  });
});

describe('schema.prisma models the documented hierarchy', () => {
  it.each(['Organization', 'Property', 'Room', 'Gateway', 'Device'])('declares %s', (model) => {
    expect(() => modelFields(model)).not.toThrow();
  });

  it('roots properties in an organization', () => {
    expect(modelFields('Property').organizationId).toBe('String');
  });

  it('roots rooms in a property', () => {
    expect(modelFields('Room').propertyId).toBe('String');
  });

  it('carries the documented device fields', () => {
    const device = modelFields('Device');

    expect(device.type).toBe('DeviceType');
    expect(device.platform).toBe('Platform');
    expect(device.externalId).toBe('String');
    expect(device.capabilities).toBe('Capability[]');
  });

  it('leaves room assignment optional for devices and gateways', () => {
    // Devices are imported before being assigned to a room (VG-013), and a
    // gateway may be claimed before placement.
    expect(modelFields('Device').roomId).toBe('String?');
    expect(modelFields('Gateway').roomId).toBe('String?');
  });

  it('makes the gateway serial number the claim identity', () => {
    expect(modelFields('Gateway').serialNumber).toBe('String');
    expect(schema).toMatch(/serialNumber\s+String\s+@unique/);
  });

  it('leaves the gateway property optional so the pre-claim state is representable', () => {
    // A gateway exists from manufacture, before any property owns it: an
    // UNCLAIMED row must be persistable with no property (VG-005 claims it).
    expect(modelFields('Gateway').propertyId).toBe('String?');
    expect(modelFields('Gateway').property).toBe('Property?');
  });

  it('still roots claimed devices and rooms in a property', () => {
    // Only the gateway is manufactured before it is owned. Nothing else in
    // the hierarchy may float free.
    expect(modelFields('Device').propertyId).toBe('String');
    expect(modelFields('Room').propertyId).toBe('String');
  });

  it('stores no credentials on the gateway record', () => {
    // docs/ARCHITECTURE.md: Tuya credentials never reach the gateway.
    //
    // Relations are excluded, because a relation is a pointer to another
    // table rather than something this record stores: VG-006 deliberately put
    // the device secret in `GatewayCredential` so this boundary stays true.
    // The check is on what a `gateways` row actually holds, which is stricter
    // than scanning every declared field -- see the migration assertion below
    // for the same rule at the storage level.
    const stored = Object.entries(modelFields('Gateway')).filter(([, type]) => !isRelation(type));

    expect(JSON.stringify(stored).toLowerCase()).not.toMatch(
      /secret|token|password|credential|apikey/,
    );
  });

  it('keeps the device credential in its own table', () => {
    // The relation is allowed; a column holding the secret would not be.
    expect(modelFields('Gateway').credential).toBe('GatewayCredential?');
    expect(modelFields('GatewayCredential').secretHash).toBe('String');
  });
});

describe('migration', () => {
  const migration = readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', '20260830000000_init', 'migration.sql'),
    'utf8',
  );

  it('creates every table', () => {
    for (const table of ['organizations', 'properties', 'rooms', 'gateways', 'devices']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('is additive: it drops nothing', () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it('creates the gateway property column nullable', () => {
    const gateways = /CREATE TABLE "gateways" \(([\s\S]*?)\n\);/.exec(migration)?.[1] ?? '';

    expect(gateways).toMatch(/"property_id" TEXT,/);
    expect(gateways).not.toMatch(/"property_id" TEXT NOT NULL/);
    // The foreign key still exists; it is the column that is optional.
    expect(migration).toMatch(
      /ALTER TABLE "gateways" ADD CONSTRAINT "gateways_property_id_fkey"[\s\S]*?REFERENCES "properties"\("id"\)/,
    );
  });

  it('keeps every other property owner required', () => {
    for (const table of ['rooms', 'devices']) {
      const body = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(
        migration,
      )?.[1];

      expect(body).toMatch(/"property_id" TEXT NOT NULL/);
    }
  });

  it('enforces the one-import-per-provider-device rule', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX "devices_property_id_platform_external_id_key"/);
  });

  it('cascades deletes down the ownership hierarchy', () => {
    const cascades = migration.match(/ON DELETE CASCADE/g) ?? [];

    // properties, rooms, gateways, devices each cascade from their owner.
    expect(cascades).toHaveLength(4);
  });

  it('unassigns rather than deletes when a room is removed', () => {
    expect(migration).toMatch(/gateways_room_id_fkey[\s\S]*?ON DELETE SET NULL/);
    expect(migration).toMatch(/devices_room_id_fkey[\s\S]*?ON DELETE SET NULL/);
  });
});

describe('schema.prisma models the account hierarchy (VG-004)', () => {
  it.each(['User', 'Membership'])('declares %s', (model) => {
    expect(() => modelFields(model)).not.toThrow();
  });

  it('makes the email address the unique sign-in identity', () => {
    expect(modelFields('User').email).toBe('String');
    expect(schema).toMatch(/email\s+String\s+@unique/);
  });

  it('stores a password hash and nothing resembling a plaintext password', () => {
    const user = modelFields('User');

    expect(user.passwordHash).toBe('String');
    expect(Object.keys(user)).not.toContain('password');
    expect(Object.keys(user)).not.toContain('plaintext');
  });

  it('links users to organizations through a membership carrying a role', () => {
    const membership = modelFields('Membership');

    expect(membership.userId).toBe('String');
    expect(membership.organizationId).toBe('String');
    expect(membership.role).toBe('MembershipRole');
  });

  it('gives a user one role per organization', () => {
    expect(schema).toMatch(/@@unique\(\[userId, organizationId\]\)/);
  });

  it('declares a status so an account can be disabled without deletion', () => {
    expect(modelFields('User').status).toBe('UserStatus');
    expect(enumValues('UserStatus').sort()).toEqual(['ACTIVE', 'DISABLED']);
  });

  it('declares the membership roles', () => {
    expect(enumValues('MembershipRole').sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);
  });
});

describe('auth migration (VG-004)', () => {
  const AUTH_MIGRATION = join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260830120000_add_auth',
    'migration.sql',
  );
  const migration = readFileSync(AUTH_MIGRATION, 'utf8');

  it('creates the user and membership tables', () => {
    for (const table of ['users', 'memberships']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('is additive: it drops nothing', () => {
    // VG-003's tables already exist wherever this runs; the account tables
    // are added alongside them, never by rebuilding.
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it('does not alter the tables VG-003 created', () => {
    // An ALTER here would mean this migration is no longer purely additive.
    for (const table of ['organizations', 'properties', 'rooms', 'gateways', 'devices']) {
      expect(migration).not.toMatch(
        new RegExp(`ALTER TABLE "${table}"[^\n]*(ADD COLUMN|DROP|ALTER COLUMN)`),
      );
    }
  });

  it('enforces one account per email address', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX "users_email_key" ON "users"\("email"\)/);
  });

  it('enforces one membership per user and organization', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX "memberships_user_id_organization_id_key"/);
  });

  it('removes memberships with the user or the organization they join', () => {
    // A membership pointing at a deleted user or organization would be a
    // dangling grant.
    expect(migration).toMatch(/memberships_user_id_fkey[\s\S]*?ON DELETE CASCADE/);
    expect(migration).toMatch(/memberships_organization_id_fkey[\s\S]*?ON DELETE CASCADE/);
  });

  it('leaves the VG-003 migration untouched', () => {
    // That migration is merged and may have been applied; changing it now
    // would diverge from any database that already ran it.
    const initial = readFileSync(
      join(__dirname, '..', 'prisma', 'migrations', '20260830000000_init', 'migration.sql'),
      'utf8',
    );

    expect(initial).not.toMatch(/\busers\b|\bmemberships\b/);
  });
});

describe('gateway credential migration (VG-006)', () => {
  const CREDENTIAL_MIGRATION = join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260830160000_add_gateway_credentials',
    'migration.sql',
  );
  const migration = readFileSync(CREDENTIAL_MIGRATION, 'utf8');

  it('creates the credential table', () => {
    expect(migration).toContain('CREATE TABLE "gateway_credentials"');
  });

  it('is additive: it drops nothing', () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it('adds no column to the gateways table', () => {
    // The boundary at the storage level: whatever the Prisma model declares,
    // a `gateways` row must not gain a credential column.
    expect(migration).not.toMatch(/ALTER TABLE "gateways"[^\n]*ADD COLUMN/);
  });

  it('holds one credential per gateway', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "gateway_credentials_gateway_id_key" ON "gateway_credentials"\("gateway_id"\)/,
    );
  });

  it('removes a credential with the gateway it belongs to', () => {
    // A credential outliving its gateway would be a grant pointing at
    // nothing, and would keep a secret alive past the hardware.
    expect(migration).toMatch(/gateway_credentials_gateway_id_fkey[\s\S]*?ON DELETE CASCADE/);
  });

  it('stores a hash, not a secret', () => {
    const table = /CREATE TABLE "gateway_credentials" \(([\s\S]*?)\n\);/.exec(migration)?.[1] ?? '';

    expect(table).toContain('"secret_hash"');
    // A column literally named for the plaintext would be the tell that
    // something is storing one.
    expect(table).not.toMatch(/"secret"|"plaintext"|"password"/);
  });

  it('leaves the tables earlier migrations created alone', () => {
    for (const table of ['gateways', 'organizations', 'properties', 'rooms', 'devices', 'users']) {
      expect(migration).not.toMatch(
        new RegExp(`ALTER TABLE "${table}"[^\n]*(ADD COLUMN|DROP|ALTER COLUMN)`),
      );
    }
  });
});
