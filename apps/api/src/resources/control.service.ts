import { Injectable, NotFoundException } from '@nestjs/common';
import type { ControlAction, ResourceTarget } from '@vg/domain';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PrismaService } from '../database/prisma.service';

import { AdapterRegistry } from './adapter.registry';
import { PolicyService, type PolicyDecision, type PolicyReason } from './policy.service';
import { ResourceResolver, type ResolutionFailure } from './resource-resolver.service';

/**
 * What happened to a control request.
 *
 * A union rather than a boolean and a message, because the four outcomes go
 * to different places: `UNRESOLVED` becomes a clarifying question (VG-026),
 * `REFUSED` becomes an explanation, `CONFIRMATION_REQUIRED` becomes a
 * question the user answers, and `FAILED` is the only one that means
 * something is wrong with the system rather than with the request.
 */
export type ControlOutcome =
  | { readonly status: 'DISPATCHED'; readonly resourceId: string }
  | { readonly status: 'UNRESOLVED'; readonly reason: ResolutionFailure; readonly matched: number }
  | {
      readonly status: 'REFUSED';
      readonly decision: Extract<PolicyDecision, 'DENY'>;
      readonly reason: PolicyReason;
      readonly resourceId: string;
    }
  | {
      readonly status: 'CONFIRMATION_REQUIRED';
      readonly reason: PolicyReason;
      readonly resourceId: string;
    }
  | { readonly status: 'FAILED'; readonly reason: string; readonly resourceId: string };

/**
 * The only route from a caller to a smart-home adapter (VG-040).
 *
 * The order below is the whole point of the class, and it is not an
 * implementation detail: tenancy, then resolution, then policy, then
 * dispatch. Nothing reaches an adapter that has not passed all four, and
 * there is no second path -- `AdapterRegistry` is not exported from
 * `ResourcesModule`, so a future controller, the AI tool layer in VG-020, and
 * anything else that arrives cannot obtain one to call directly.
 *
 * `docs/ARCHITECTURE.md` states the boundary; this class is where it is
 * enforced rather than described.
 */
@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ResourceResolver,
    private readonly policy: PolicyService,
    private readonly adapters: AdapterRegistry,
  ) {}

  async control(
    caller: AuthenticatedUser,
    target: ResourceTarget,
    action: ControlAction,
  ): Promise<ControlOutcome> {
    // 1. Tenancy. Resolved from the property the caller named, before any
    //    query touches a resource: a caller who cannot see the villa must not
    //    be able to learn what is in it by watching which targets resolve.
    //    The rejection is the same 404 whether the property does not exist or
    //    belongs to someone else, as VG-005 established.
    const organizationId = await this.organizationForProperty(target.propertyId);
    if (organizationId === null || !this.isMember(caller, organizationId)) {
      throw propertyNotFound();
    }

    // 2. Resolution. One resource, or a reason there is not one.
    const resolution = await this.resolver.resolve(target);
    if (!resolution.ok) {
      return { status: 'UNRESOLVED', reason: resolution.reason, matched: resolution.matched };
    }

    const resource = resolution.resource;

    // A resource in another property cannot be reached through the query
    // above, which is scoped by `propertyId`. Asserted anyway: this is the
    // cross-tenant invariant, and an invariant that is only maintained by a
    // `where` clause somewhere else is one refactor from being lost.
    if (resource.propertyId !== target.propertyId) {
      throw propertyNotFound();
    }

    // 3. Policy.
    const outcome = this.policy.evaluate({ caller, organizationId, resource, action });

    if (outcome.decision === 'DENY') {
      return {
        status: 'REFUSED',
        decision: 'DENY',
        reason: outcome.reason,
        resourceId: resource.id,
      };
    }

    if (outcome.decision === 'CONFIRMATION_REQUIRED') {
      // Returned without dispatching. Confirming is a second call by a caller
      // that has asked the user; VG-040 does not carry a confirmation token,
      // because a token that nothing yet verifies is a security surface with
      // no security in it.
      return {
        status: 'CONFIRMATION_REQUIRED',
        reason: outcome.reason,
        resourceId: resource.id,
      };
    }

    // 4. Dispatch. Only now is a provider identifier read.
    if (resource.binding === null) {
      return {
        status: 'FAILED',
        reason: 'RESOURCE_NOT_BOUND',
        resourceId: resource.id,
      };
    }

    const adapter = this.adapters.get(resource.binding.platform);
    if (adapter === null) {
      // The platform is known to the model but has no adapter deployed here.
      // An ordinary answer, not a crash: environments differ.
      return {
        status: 'FAILED',
        reason: 'NO_ADAPTER_FOR_PLATFORM',
        resourceId: resource.id,
      };
    }

    const result = await adapter.execute({
      externalId: resource.binding.externalId,
      capability: action.capability,
      value: action.value,
    });

    if (!result.ok) {
      return { status: 'FAILED', reason: result.reason, resourceId: resource.id };
    }

    return { status: 'DISPATCHED', resourceId: resource.id };
  }

  /** The organization owning a property, or null when there is no such property. */
  private async organizationForProperty(propertyId: string): Promise<string | null> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { organizationId: true },
    });

    return property?.organizationId ?? null;
  }

  private isMember(caller: AuthenticatedUser, organizationId: string): boolean {
    return caller.memberships.some((membership) => membership.organizationId === organizationId);
  }
}

/**
 * The single rejection for a property the caller may not act in.
 *
 * One shape whether the property does not exist or belongs to another
 * organization, so this cannot be used to discover which property ids are
 * real -- the same reasoning as `gatewayNotFound()`.
 */
function propertyNotFound(): NotFoundException {
  return new NotFoundException('No such property.');
}
