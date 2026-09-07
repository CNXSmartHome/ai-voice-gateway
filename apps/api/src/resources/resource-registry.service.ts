import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Capability, Platform, ResourceKind } from '@vg/domain';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PrismaService } from '../database/prisma.service';
import {
  findUnsupportedCapabilities,
  toDbCapability,
  toDbDeviceType,
  toDbPlatform,
} from '../database/domain-mapping';

import { RESOURCE_SELECT, toResourceView, type ResourceView } from './resource.view';

/**
 * Roles permitted to register a resource.
 *
 * Registering decides what the system is willing to act on and binds it to a
 * provider account, which is an administrative act over the villa's
 * configuration. `MEMBER` -- residents and guests -- may control what is
 * registered but not decide what exists, the same split VG-005 draws for
 * claiming hardware.
 */
export const REGISTER_ROLES: readonly string[] = ['OWNER', 'ADMIN'];

export interface RegisterResourceInput {
  /** The villa. */
  readonly propertyId: string;
  /** The zone. Optional: a resource may be registered before it is placed. */
  readonly roomId?: string;
  readonly name: string;
  readonly kind: ResourceKind;
  readonly capabilities: readonly Capability[];
  readonly platform: Platform;
  readonly externalId: string;
  readonly enabled?: boolean;
}

export interface ListResourcesFilter {
  readonly propertyId?: string;
  readonly roomId?: string;
}

/**
 * Registration and read access for resources (VG-040).
 *
 * Every method scopes to the caller's organizations, and every rejection for
 * something the caller cannot see is the same 404, so neither resource ids
 * nor property ids can be probed through this service.
 *
 * It returns `ResourceView`, never a row: the provider binding it writes is
 * not readable back through any method here.
 */
@Injectable()
export class ResourceRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers a resource against a property and, optionally, a room.
   *
   * The resource and its binding are written in one transaction. They carry
   * the same `property_id`, which is what makes the binding's uniqueness
   * constraint a per-villa constraint; nothing else writes either table, so
   * the two cannot drift apart.
   */
  async register(caller: AuthenticatedUser, input: RegisterResourceInput): Promise<ResourceView> {
    // Capability validity is a domain rule the Postgres enum cannot express:
    // it constrains the set of names, not which are meaningful on a curtain.
    const unsupported = findUnsupportedCapabilities(input.kind, input.capabilities);
    if (unsupported.length > 0) {
      throw new BadRequestException(`A ${input.kind} does not support: ${unsupported.join(', ')}.`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Resolve the property first, so a caller who cannot see it cannot use
      // this endpoint to test whether a room id or an external id exists.
      const property = await tx.property.findUnique({
        where: { id: input.propertyId },
        select: { id: true, organizationId: true },
      });

      if (property === null || !this.mayRegisterIn(caller, property.organizationId)) {
        throw propertyNotFound();
      }

      if (input.roomId !== undefined) {
        const room = await tx.room.findUnique({
          where: { id: input.roomId },
          select: { propertyId: true },
        });

        // A zone in another villa would put the resource somewhere it is not.
        if (room === null || room.propertyId !== property.id) {
          throw propertyNotFound();
        }
      }

      const created = await tx.resource
        .create({
          data: {
            propertyId: property.id,
            roomId: input.roomId ?? null,
            name: input.name,
            kind: toDbDeviceType(input.kind),
            capabilities: input.capabilities.map(toDbCapability),
            enabled: input.enabled ?? true,
            binding: {
              create: {
                // Same property as the resource, by construction.
                propertyId: property.id,
                platform: toDbPlatform(input.platform),
                externalId: input.externalId,
              },
            },
          },
          select: RESOURCE_SELECT,
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) throw alreadyRegistered();
          throw error;
        });

      return toResourceView(created);
    });
  }

  /**
   * Lists resources in every organization the caller belongs to.
   *
   * Scoped through the owning property rather than from anything the caller
   * supplies. `propertyId` and `roomId` are filters, not lookups: one the
   * caller cannot see narrows the result to nothing rather than raising, so
   * neither can be used to test whether an id is real.
   */
  async list(caller: AuthenticatedUser, filter: ListResourcesFilter = {}): Promise<ResourceView[]> {
    const organizationIds = caller.memberships.map((membership) => membership.organizationId);
    if (organizationIds.length === 0) return [];

    const resources = await this.prisma.resource.findMany({
      where: {
        property: {
          organizationId: { in: organizationIds },
          ...(filter.propertyId === undefined ? {} : { id: filter.propertyId }),
        },
        ...(filter.roomId === undefined ? {} : { roomId: filter.roomId }),
      },
      select: RESOURCE_SELECT,
      orderBy: [{ propertyId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });

    return resources.map(toResourceView);
  }

  /**
   * One resource, if the caller belongs to the organization that owns it.
   *
   * A resource in another organization is the same 404 as one that does not
   * exist. This is the cross-tenant read boundary.
   */
  async get(caller: AuthenticatedUser, resourceId: string): Promise<ResourceView> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: { ...RESOURCE_SELECT, property: { select: { organizationId: true } } },
    });

    if (resource === null) throw resourceNotFound();
    if (!this.isMember(caller, resource.property.organizationId)) throw resourceNotFound();

    return toResourceView(resource);
  }

  /**
   * Takes a resource in or out of service.
   *
   * Reversible, and it leaves the binding in place: a bulb being replaced
   * should not have to be re-registered, and the resolver reports `DISABLED`
   * rather than `NOT_FOUND` so a caller can be told why nothing happened.
   */
  async setEnabled(
    caller: AuthenticatedUser,
    resourceId: string,
    enabled: boolean,
  ): Promise<ResourceView> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: { id: true, property: { select: { organizationId: true } } },
    });

    if (resource === null || !this.mayRegisterIn(caller, resource.property.organizationId)) {
      throw resourceNotFound();
    }

    const updated = await this.prisma.resource.update({
      where: { id: resource.id },
      data: { enabled },
      select: RESOURCE_SELECT,
    });

    return toResourceView(updated);
  }

  private isMember(caller: AuthenticatedUser, organizationId: string): boolean {
    return caller.memberships.some((membership) => membership.organizationId === organizationId);
  }

  private mayRegisterIn(caller: AuthenticatedUser, organizationId: string): boolean {
    return caller.memberships.some(
      (membership) =>
        membership.organizationId === organizationId && REGISTER_ROLES.includes(membership.role),
    );
  }
}

/** Prisma reports a unique constraint violation as P2002. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as { code: unknown }).code === 'P2002';
}

function propertyNotFound(): NotFoundException {
  return new NotFoundException('No such property.');
}

function resourceNotFound(): NotFoundException {
  return new NotFoundException('No such resource.');
}

/**
 * Both uniqueness constraints produce this.
 *
 * One shape for "a resource of that kind and name is already in that zone"
 * and "that provider device is already registered in this villa": the caller
 * is told the registration did not apply, without being told which existing
 * row it collided with.
 */
function alreadyRegistered(): ConflictException {
  return new ConflictException('That resource is already registered.');
}
