import { Injectable } from '@nestjs/common';
import type { Capability, Platform, ResourceKind, ResourceTarget } from '@vg/domain';

import { PrismaService } from '../database/prisma.service';
import {
  toDbDeviceType,
  toDomainCapability,
  toDomainDeviceType,
  toDomainPlatform,
} from '../database/domain-mapping';

/**
 * A resource with the binding the pipeline needs to dispatch.
 *
 * Internal to this module. It is not a `ResourceView`, and deliberately so:
 * the binding is present here because `ControlService` is about to use it,
 * and absent from the view because nothing outside may.
 */
export interface ResolvedResource {
  readonly id: string;
  readonly propertyId: string;
  readonly roomId: string | null;
  readonly name: string;
  readonly kind: ResourceKind;
  readonly capabilities: readonly Capability[];
  readonly enabled: boolean;
  readonly binding: { readonly platform: Platform; readonly externalId: string } | null;
}

/**
 * Why a target did not resolve to exactly one thing to act on.
 *
 * Three reasons rather than one, because they are three different things for
 * a caller to say. VG-026 turns `AMBIGUOUS` into "which one, the desk lamp or
 * the ceiling light?"; it cannot do that if the pipeline only reports failure.
 */
export type ResolutionFailure = 'NOT_FOUND' | 'AMBIGUOUS' | 'DISABLED';

export type Resolution =
  | { readonly ok: true; readonly resource: ResolvedResource }
  | {
      readonly ok: false;
      readonly reason: ResolutionFailure;
      /** How many resources matched, before enablement was considered. */
      readonly matched: number;
    };

/**
 * Turns a logical target into exactly one resource, or a reason why not.
 *
 * "Deterministic" is the requirement that matters. The same target against
 * the same data must always give the same answer, including the same failure
 * reason -- so this never picks a winner from several candidates, and the
 * query orders its results rather than relying on whatever the planner
 * returns. A resolver that silently chose the first of two matching lights
 * would work in testing and turn on the wrong lamp in someone's villa.
 */
@Injectable()
export class ResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves within one property. Never across properties.
   *
   * The property comes from the target, and the caller's right to that
   * property is established before this runs -- see `ControlService`. This
   * service does no authorization of its own, which is why it is not
   * exported from the module.
   */
  async resolve(target: ResourceTarget): Promise<Resolution> {
    const candidates = await this.prisma.resource.findMany({
      where: {
        propertyId: target.propertyId,
        ...(target.roomId === undefined ? {} : { roomId: target.roomId }),
        ...(target.kind === undefined ? {} : { kind: toDbDeviceType(target.kind) }),
        // Case-insensitive but exact: "Ceiling Light" and "ceiling light" are
        // the same request, "ceiling" is not. Substring matching would make
        // ambiguity depend on how someone named an unrelated resource.
        ...(target.name === undefined
          ? {}
          : { name: { equals: target.name, mode: 'insensitive' as const } }),
      },
      select: {
        id: true,
        propertyId: true,
        roomId: true,
        name: true,
        kind: true,
        capabilities: true,
        enabled: true,
        binding: { select: { platform: true, externalId: true } },
      },
      // Deterministic order, so a repeated ambiguous call reports the same
      // candidates in the same sequence.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    if (candidates.length === 0) return { ok: false, reason: 'NOT_FOUND', matched: 0 };

    const enabled = candidates.filter((candidate) => candidate.enabled);

    // Everything that matched is switched off. Distinct from NOT_FOUND: the
    // resource exists and the caller named it correctly, so the honest answer
    // is "that one is out of service", not "there is no such thing".
    if (enabled.length === 0) {
      return { ok: false, reason: 'DISABLED', matched: candidates.length };
    }

    if (enabled.length > 1) {
      return { ok: false, reason: 'AMBIGUOUS', matched: enabled.length };
    }

    const [only] = enabled;
    /* istanbul ignore next -- length is exactly 1 here; this satisfies the compiler */
    if (only === undefined) return { ok: false, reason: 'NOT_FOUND', matched: 0 };

    return {
      ok: true,
      resource: {
        id: only.id,
        propertyId: only.propertyId,
        roomId: only.roomId,
        name: only.name,
        kind: toDomainDeviceType(only.kind),
        capabilities: only.capabilities.map(toDomainCapability),
        enabled: only.enabled,
        binding:
          only.binding === null
            ? null
            : {
                platform: toDomainPlatform(only.binding.platform),
                externalId: only.binding.externalId,
              },
      },
    };
  }
}
