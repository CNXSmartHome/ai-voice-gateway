import {
  Capability as DbCapability,
  DeviceType as DbDeviceType,
  Platform as DbPlatform,
  type Device as DbDevice,
} from '@prisma/client';
import {
  CAPABILITIES,
  DEVICE_TYPES,
  PLATFORMS,
  isCapabilitySupported,
  type Capability,
  type Device,
  type DeviceType,
  type Platform,
} from '@vg/domain';

/**
 * Translation between the storage representation and the canonical domain
 * model in packages/domain.
 *
 * Storage uses SCREAMING_SNAKE_CASE because that is the Postgres enum
 * convention; the domain uses the lowercase names from
 * docs/DEVICE_MODEL.md. This module is the only place that knows both, so
 * a canonical name never has to be spelled twice elsewhere.
 *
 * The mapping is mechanical rather than a hand-written table: a lookup table
 * would be another thing to keep in step, and the drift tests assert the
 * transformation is total and reversible over every declared value.
 */

function toScreamingSnake(value: string): string {
  return value.toUpperCase();
}

function toCanonical(value: string): string {
  return value.toLowerCase();
}

export function toDomainDeviceType(value: DbDeviceType): DeviceType {
  const canonical = toCanonical(value);
  // A value in the database enum that the domain does not know means the two
  // have drifted; failing loudly beats silently emitting an invalid type.
  if (!(DEVICE_TYPES as readonly string[]).includes(canonical)) {
    throw new Error(`Unknown device type in database: ${value}`);
  }
  return canonical as DeviceType;
}

export function toDbDeviceType(value: DeviceType): DbDeviceType {
  const stored = toScreamingSnake(value);
  if (!(stored in DbDeviceType)) {
    throw new Error(`Unknown device type in domain: ${value}`);
  }
  return stored as DbDeviceType;
}

export function toDomainPlatform(value: DbPlatform): Platform {
  const canonical = toCanonical(value);
  if (!(PLATFORMS as readonly string[]).includes(canonical)) {
    throw new Error(`Unknown platform in database: ${value}`);
  }
  return canonical as Platform;
}

export function toDbPlatform(value: Platform): DbPlatform {
  const stored = toScreamingSnake(value);
  if (!(stored in DbPlatform)) {
    throw new Error(`Unknown platform in domain: ${value}`);
  }
  return stored as DbPlatform;
}

export function toDomainCapability(value: DbCapability): Capability {
  const canonical = toCanonical(value);
  if (!(CAPABILITIES as readonly string[]).includes(canonical)) {
    throw new Error(`Unknown capability in database: ${value}`);
  }
  return canonical as Capability;
}

export function toDbCapability(value: Capability): DbCapability {
  const stored = toScreamingSnake(value);
  if (!(stored in DbCapability)) {
    throw new Error(`Unknown capability in domain: ${value}`);
  }
  return stored as DbCapability;
}

/** Maps a persisted device row to the platform-neutral domain record. */
export function toDomainDevice(row: DbDevice): Device {
  return {
    id: row.id,
    name: row.name,
    room_id: row.roomId,
    type: toDomainDeviceType(row.type),
    platform: toDomainPlatform(row.platform),
    external_id: row.externalId,
    capabilities: row.capabilities.map(toDomainCapability),
  };
}

/**
 * Rejects capabilities a device type cannot have.
 *
 * Postgres enums constrain a capability to the *set* of known names, but
 * cannot express that `brightness` is meaningless on a curtain. That rule
 * lives in the domain model, so it is enforced here, on the way in.
 *
 * Returns the offending capabilities; empty means valid.
 */
export function findUnsupportedCapabilities(
  type: DeviceType,
  capabilities: readonly Capability[],
): Capability[] {
  return capabilities.filter((capability) => !isCapabilitySupported(type, capability));
}

/**
 * Throws when a device declares a capability its type does not support.
 *
 * Call before any write that sets capabilities.
 */
export function assertCapabilitiesSupported(
  type: DeviceType,
  capabilities: readonly Capability[],
): void {
  const unsupported = findUnsupportedCapabilities(type, capabilities);
  if (unsupported.length > 0) {
    throw new Error(`Device type "${type}" does not support: ${unsupported.join(', ')}`);
  }
}
