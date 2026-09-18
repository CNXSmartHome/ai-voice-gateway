/**
 * Smart-home platforms with an adapter in the MVP.
 *
 * SmartThings, Google Home, and Matter are explicitly out of MVP scope
 * (docs/PRODUCT.md).
 *
 * `home_assistant` exists so that provider independence is demonstrable
 * rather than merely asserted. A registry keyed by platform with exactly one
 * platform in it proves nothing: any provider-specific assumption that leaked
 * into the pipeline would still pass every test. VG-040 registers a stub
 * adapter under this platform to hold the boundary open; the real Home
 * Assistant integration is not part of that task.
 */
export const PLATFORMS = ['tuya', 'home_assistant'] as const;

export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}
