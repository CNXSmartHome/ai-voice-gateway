import {
  Capability as DbCapability,
  DeviceType as DbDeviceType,
  Platform as DbPlatform,
  type Device as DbDevice,
} from '@prisma/client';
import { CAPABILITIES, DEVICE_TYPES, PLATFORMS } from '@vg/domain';

import {
  assertCapabilitiesSupported,
  findUnsupportedCapabilities,
  toDbCapability,
  toDbDeviceType,
  toDbPlatform,
  toDomainCapability,
  toDomainDevice,
  toDomainDeviceType,
  toDomainPlatform,
} from '../src/database/domain-mapping';

describe('device type mapping', () => {
  it.each(DEVICE_TYPES)('round-trips %s', (type) => {
    expect(toDomainDeviceType(toDbDeviceType(type))).toBe(type);
  });

  it.each(Object.values(DbDeviceType))('round-trips database value %s', (stored) => {
    expect(toDbDeviceType(toDomainDeviceType(stored))).toBe(stored);
  });

  it('rejects a database value the domain does not know', () => {
    expect(() => toDomainDeviceType('LOCK' as DbDeviceType)).toThrow(/Unknown device type/);
  });

  it('rejects a domain value the database does not know', () => {
    expect(() => toDbDeviceType('lock' as never)).toThrow(/Unknown device type/);
  });
});

describe('platform mapping', () => {
  it.each(PLATFORMS)('round-trips %s', (platform) => {
    expect(toDomainPlatform(toDbPlatform(platform))).toBe(platform);
  });

  it('rejects an out-of-scope platform', () => {
    expect(() => toDomainPlatform('SMARTTHINGS' as DbPlatform)).toThrow(/Unknown platform/);
  });
});

describe('capability mapping', () => {
  it.each(CAPABILITIES)('round-trips %s', (capability) => {
    expect(toDomainCapability(toDbCapability(capability))).toBe(capability);
  });

  it.each(Object.values(DbCapability))('round-trips database value %s', (stored) => {
    expect(toDbCapability(toDomainCapability(stored))).toBe(stored);
  });

  it('rejects a provider-specific name', () => {
    expect(() => toDomainCapability('SWITCH_1' as DbCapability)).toThrow(/Unknown capability/);
  });
});

describe('schema and domain enum parity', () => {
  it('declares the same device types in both', () => {
    const stored = Object.values(DbDeviceType).map((v) => v.toLowerCase());

    expect(stored.sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it('declares the same platforms in both', () => {
    const stored = Object.values(DbPlatform).map((v) => v.toLowerCase());

    expect(stored.sort()).toEqual([...PLATFORMS].sort());
  });

  it('declares the same capabilities in both', () => {
    const stored = Object.values(DbCapability).map((v) => v.toLowerCase());

    expect(stored.sort()).toEqual([...CAPABILITIES].sort());
  });
});

describe('toDomainDevice', () => {
  const row: DbDevice = {
    id: 'dev_10021',
    propertyId: 'prop_1',
    roomId: 'room_master',
    name: 'Bedroom AC',
    type: DbDeviceType.CLIMATE,
    platform: DbPlatform.TUYA,
    externalId: 'provider-device-id',
    capabilities: [
      DbCapability.POWER,
      DbCapability.TARGET_TEMPERATURE,
      DbCapability.HVAC_MODE,
      DbCapability.FAN_SPEED,
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('maps a row to the documented device shape', () => {
    expect(toDomainDevice(row)).toEqual({
      id: 'dev_10021',
      name: 'Bedroom AC',
      room_id: 'room_master',
      type: 'climate',
      platform: 'tuya',
      external_id: 'provider-device-id',
      capabilities: ['power', 'target_temperature', 'hvac_mode', 'fan_speed'],
    });
  });

  it('preserves a null room for an unassigned device', () => {
    expect(toDomainDevice({ ...row, roomId: null }).room_id).toBeNull();
  });

  it('does not leak storage-only columns into the domain record', () => {
    const keys = Object.keys(toDomainDevice(row));

    expect(keys).not.toContain('propertyId');
    expect(keys).not.toContain('createdAt');
    expect(keys).not.toContain('updatedAt');
  });
});

describe('capability validation against device type', () => {
  it('accepts capabilities the type supports', () => {
    expect(findUnsupportedCapabilities('light', ['power', 'brightness', 'rgb'])).toEqual([]);
  });

  it('reports capabilities the type does not support', () => {
    expect(findUnsupportedCapabilities('curtain', ['power', 'brightness', 'rgb'])).toEqual([
      'brightness',
      'rgb',
    ]);
  });

  it('rejects power on a scene, which is executed rather than powered', () => {
    expect(findUnsupportedCapabilities('scene', ['power'])).toEqual(['power']);
    expect(findUnsupportedCapabilities('scene', ['execute'])).toEqual([]);
  });

  it('accepts an empty capability list', () => {
    expect(findUnsupportedCapabilities('switch', [])).toEqual([]);
  });

  it('throws naming the offending capabilities', () => {
    expect(() => assertCapabilitiesSupported('switch', ['power', 'brightness'])).toThrow(
      /does not support: brightness/,
    );
  });

  it('does not throw for a valid combination', () => {
    expect(() => assertCapabilitiesSupported('climate', ['power', 'hvac_mode'])).not.toThrow();
  });
});
