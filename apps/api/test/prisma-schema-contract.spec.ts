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

  it('stores no smart-home credentials on the gateway', () => {
    // docs/ARCHITECTURE.md: Tuya credentials never reach the gateway.
    const gateway = JSON.stringify(modelFields('Gateway')).toLowerCase();

    expect(gateway).not.toMatch(/secret|token|password|credential|apikey/);
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
