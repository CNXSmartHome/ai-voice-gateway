/**
 * MVP device types (docs/DEVICE_MODEL.md).
 *
 * Adding a type here is an architecture change and requires an issue --
 * see AI_GOVERNANCE.md (DUAL_AI_REVIEW).
 */
export const DEVICE_TYPES = ['light', 'climate', 'curtain', 'switch', 'scene'] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && (DEVICE_TYPES as readonly string[]).includes(value);
}
