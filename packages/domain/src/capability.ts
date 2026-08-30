import { DEVICE_TYPES, type DeviceType } from './device-type';

/**
 * Canonical capabilities (docs/DEVICE_MODEL.md).
 *
 * These are the ONLY capability names that may reach the AI tool layer.
 * Provider-specific names are normalized in the adapter layer before
 * crossing this boundary (docs/ARCHITECTURE.md - non-negotiable boundaries).
 */
export const CAPABILITIES = [
  // common
  'power',
  // light
  'brightness',
  'color_temperature',
  'rgb',
  // climate
  'target_temperature',
  'current_temperature',
  'hvac_mode',
  'fan_speed',
  // curtain
  'position',
  'open',
  'close',
  'stop',
  // scene
  'execute',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Capability available on every controllable device type. */
const COMMON_CAPABILITIES = ['power'] as const satisfies readonly Capability[];

/**
 * Capabilities a device type is allowed to expose, keyed by type.
 *
 * A `scene` is executed rather than powered, so it does not inherit the
 * common `power` capability.
 */
export const CAPABILITIES_BY_DEVICE_TYPE: Readonly<Record<DeviceType, readonly Capability[]>> =
  Object.freeze({
    light: [...COMMON_CAPABILITIES, 'brightness', 'color_temperature', 'rgb'],
    climate: [
      ...COMMON_CAPABILITIES,
      'target_temperature',
      'current_temperature',
      'hvac_mode',
      'fan_speed',
    ],
    curtain: [...COMMON_CAPABILITIES, 'position', 'open', 'close', 'stop'],
    switch: [...COMMON_CAPABILITIES],
    scene: ['execute'],
  });

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

/** True when `capability` is valid for `deviceType`. */
export function isCapabilitySupported(deviceType: DeviceType, capability: Capability): boolean {
  return CAPABILITIES_BY_DEVICE_TYPE[deviceType].includes(capability);
}

/** Every device type declared in the model, for exhaustive iteration in tests and tooling. */
export function listDeviceTypes(): readonly DeviceType[] {
  return DEVICE_TYPES;
}
