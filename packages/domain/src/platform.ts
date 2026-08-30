/**
 * Smart-home platforms with an adapter in the MVP.
 *
 * SmartThings, Google Home, and Matter are explicitly out of MVP scope
 * (docs/PRODUCT.md).
 */
export const PLATFORMS = ['tuya'] as const;

export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}
