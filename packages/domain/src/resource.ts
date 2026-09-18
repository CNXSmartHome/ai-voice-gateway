import type { Capability } from './capability';
import { DEVICE_TYPES, type DeviceType } from './device-type';

/**
 * The kinds of thing the control pipeline can act on (VG-040).
 *
 * Deliberately the same vocabulary as `DEVICE_TYPES` rather than a parallel
 * one. A resource generalizes *ownership, resolution, and control* — who may
 * act on a thing and how a request reaches it — not what kinds of thing
 * exist. Introducing a second list would mean two places to add `fan` to,
 * and a mapping between them that could drift; `docs/DEVICE_MODEL.md` stays
 * the single specification of the vocabulary.
 */
export const RESOURCE_KINDS = DEVICE_TYPES;

export type ResourceKind = DeviceType;

export function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * A value a capability can carry.
 *
 * Matches the control payload in `docs/API.md`: `power` takes a boolean,
 * `brightness` a number, `hvac_mode` a string. Deliberately not `unknown`,
 * so an adapter cannot be handed an object it has to guess the shape of.
 */
export type ControlValue = boolean | number | string;

/** What a caller wants done, in canonical terms. No provider vocabulary. */
export interface ControlAction {
  readonly capability: Capability;
  readonly value: ControlValue;
}

/**
 * A logical description of what to act on, before resolution.
 *
 * This is what a caller — the AI tool layer in VG-019/VG-021, an operator
 * endpoint later — knows: a villa, perhaps a zone, perhaps a kind, perhaps a
 * name. It never carries a provider identifier, which is the point: nothing
 * upstream of the registry can address a device on a platform directly.
 *
 * In Smart Villa terms `propertyId` is the villa and `roomId` is the zone.
 */
export interface ResourceTarget {
  readonly propertyId: string;
  readonly roomId?: string;
  readonly kind?: ResourceKind;
  /** Matched case-insensitively and exactly; not a search. */
  readonly name?: string;
}
