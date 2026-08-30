import type { Capability } from './capability';
import type { DeviceType } from './device-type';
import type { Platform } from './platform';

/**
 * Universal device record (docs/DEVICE_MODEL.md).
 *
 * This is the platform-neutral representation. `external_id` is the only
 * field carrying provider identity, and no provider-specific capability
 * name may appear in `capabilities`.
 */
export interface Device {
  readonly id: string;
  readonly name: string;
  /** Null until the device is assigned to a room (VG-013). */
  readonly room_id: string | null;
  readonly type: DeviceType;
  readonly platform: Platform;
  /** Provider-side device identifier, used only by the adapter layer. */
  readonly external_id: string;
  readonly capabilities: readonly Capability[];
}

/** Hierarchy: Organization -> Property -> Room -> Gateway / Device. */
export interface Organization {
  readonly id: string;
  readonly name: string;
}

export interface Property {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
}

export interface Room {
  readonly id: string;
  readonly property_id: string;
  readonly name: string;
}
