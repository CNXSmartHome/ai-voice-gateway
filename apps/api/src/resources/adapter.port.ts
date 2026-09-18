import type { Capability, ControlValue, Platform } from '@vg/domain';

/**
 * The provider-independent boundary (VG-040).
 *
 * Everything above this line speaks the canonical vocabulary from
 * `docs/DEVICE_MODEL.md`; everything below it may speak whatever its platform
 * speaks. `docs/ARCHITECTURE.md` makes that separation non-negotiable, and
 * this interface is where it is actually enforced: a Tuya type appearing in
 * any signature here would be the violation, not a style problem.
 *
 * VG-009 implements and refines adapter behaviour against this port; VG-012
 * normalizes provider capabilities into the canonical ones it accepts. VG-040
 * defines the shape and ships one stub.
 */
export interface AdapterCommand {
  /** The provider's own identifier, from the resource binding. */
  readonly externalId: string;
  readonly capability: Capability;
  readonly value: ControlValue;
}

/**
 * The outcome of a dispatch.
 *
 * A failed command is a value rather than an exception because an
 * unreachable bulb is an ordinary answer to "turn on the light", not an
 * error in the pipeline. The caller needs to tell the two apart, and a thrown
 * provider error would flatten them.
 */
export type AdapterResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface SmartHomeAdapter {
  /** The platform this adapter is registered under. */
  readonly platform: Platform;
  execute(command: AdapterCommand): Promise<AdapterResult>;
}

/** Injection token for the set of adapters available to the registry. */
export const SMART_HOME_ADAPTERS = Symbol('SMART_HOME_ADAPTERS');
