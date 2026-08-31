import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PrismaService } from '../database/prisma.service';

import { PROPERTY_SELECT, toPropertyView, type PropertyView } from './property.view';

/**
 * Roles permitted to create or change a property.
 *
 * Deliberately the same set VG-005 requires to claim hardware into one:
 * arranging the places a system covers is administrative, and `MEMBER` is
 * the role for residents and guests, who live in a property rather than
 * define it. A test asserts the two lists stay in agreement, so a change to
 * one is a decision rather than a drift.
 */
export const PROPERTY_WRITE_ROLES: readonly string[] = ['OWNER', 'ADMIN'];

export interface CreatePropertyInput {
  readonly organizationId: string;
  readonly name: string;
}

export interface UpdatePropertyInput {
  readonly name: string;
}

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a property in an organization the caller administers.
   *
   * An organization the caller is not a member of is a `404`: they cannot see
   * it, and confirming it exists would turn this endpoint into a way to
   * enumerate organization ids. An organization they *are* a member of but
   * lack the role in is a `403`, because they already know it exists — they
   * are in it — and a `404` there would only be confusing.
   */
  async create(caller: AuthenticatedUser, input: CreatePropertyInput): Promise<PropertyView> {
    this.assertMayAdminister(caller, input.organizationId);

    try {
      const property = await this.prisma.property.create({
        data: { organizationId: input.organizationId, name: input.name },
        select: PROPERTY_SELECT,
      });
      return toPropertyView(property);
    } catch (error) {
      // The schema makes a name unique within its organization. Reported
      // plainly: the caller can already list their own properties, so there
      // is nothing here to hide, and "that name is taken" is what they need
      // to know.
      if (isUniqueViolation(error)) {
        throw new ConflictException('A property with that name already exists.');
      }
      // The membership was read from the caller's token payload, so the
      // organization could have been deleted since. The database catches it;
      // the caller gets the same answer as for one they cannot see.
      if (isReferentialFailure(error)) throw propertyNotFound();
      throw error;
    }
  }

  /**
   * Lists the properties of every organization the caller belongs to.
   *
   * Scoped from the caller's memberships rather than from anything they
   * supply, so there is no parameter to tamper with. A caller with no
   * memberships gets an empty list, not an error.
   */
  async list(caller: AuthenticatedUser): Promise<PropertyView[]> {
    const organizationIds = caller.memberships.map((membership) => membership.organizationId);
    if (organizationIds.length === 0) return [];

    const properties = await this.prisma.property.findMany({
      where: { organizationId: { in: organizationIds } },
      select: PROPERTY_SELECT,
      orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
    });

    return properties.map(toPropertyView);
  }

  /** One property, if the caller is a member of the organization that owns it. */
  async get(caller: AuthenticatedUser, propertyId: string): Promise<PropertyView> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: PROPERTY_SELECT,
    });

    if (property === null || !this.isMember(caller, property.organizationId)) {
      throw propertyNotFound();
    }

    return toPropertyView(property);
  }

  /**
   * Renames a property.
   *
   * The two failure codes are different on purpose. A property in an
   * organization the caller does not belong to is a `404` — they have no way
   * to know it exists and this must not become the way. A property they can
   * read but not administer is a `403`, since `GET` already told them it is
   * there and pretending otherwise would only mislead.
   *
   * This is a finer distinction than `POST /v1/gateways/claim` draws, and
   * deliberately so: that endpoint's caller has no read access to properties
   * at all, so every rejection there has to look identical.
   */
  async update(
    caller: AuthenticatedUser,
    propertyId: string,
    input: UpdatePropertyInput,
  ): Promise<PropertyView> {
    const existing = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { organizationId: true },
    });

    if (existing === null || !this.isMember(caller, existing.organizationId)) {
      throw propertyNotFound();
    }
    this.assertMayAdminister(caller, existing.organizationId);

    // The organization this caller was authorized against, carried into the
    // write. Authorization was decided from a row read a moment ago, and a
    // property could be moved to another organization in between; without
    // this the write would apply to a property the caller was never
    // authorized for. Refusing looks exactly like a property they cannot see,
    // which by then is what it is.
    const authorizedOrganizationId = existing.organizationId;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const renamed = await tx.property.updateMany({
          where: { id: propertyId, organizationId: authorizedOrganizationId },
          data: { name: input.name },
        });

        if (renamed.count !== 1) throw propertyNotFound();

        // Read back inside the transaction, after the write. The row is
        // locked by the update until commit, so this is the authoritative
        // result rather than a second guess at it.
        const property = await tx.property.findUniqueOrThrow({
          where: { id: propertyId },
          select: PROPERTY_SELECT,
        });

        return toPropertyView(property);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A property with that name already exists.');
      }
      // Deleted between the read and the write.
      if (isReferentialFailure(error)) throw propertyNotFound();
      throw error;
    }
  }

  private isMember(caller: AuthenticatedUser, organizationId: string): boolean {
    return caller.memberships.some((membership) => membership.organizationId === organizationId);
  }

  /**
   * Throws the right refusal for a caller who may not write here.
   *
   * Reads the memberships the guard loaded, so the decision uses the
   * caller's current roles rather than anything carried in their token.
   */
  private assertMayAdminister(caller: AuthenticatedUser, organizationId: string): void {
    const membership = caller.memberships.find(
      (candidate) => candidate.organizationId === organizationId,
    );

    if (membership === undefined) throw propertyNotFound();
    if (!PROPERTY_WRITE_ROLES.includes(membership.role)) {
      throw new ForbiddenException('Only an owner or admin can change a property.');
    }
  }
}

/** Prisma reports a unique constraint violation as P2002. */
function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2002';
}

/** A foreign key violation (P2003) or a row that vanished (P2025). */
function isReferentialFailure(error: unknown): boolean {
  const code = prismaCode(error);
  return code === 'P2003' || code === 'P2025';
}

function prismaCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return (error as { code: unknown }).code;
}

/**
 * The rejection for a property the caller cannot see.
 *
 * One shape whether it does not exist or belongs to someone else, so the
 * endpoint cannot be used to discover which property ids are real.
 */
function propertyNotFound(): NotFoundException {
  return new NotFoundException('No such property.');
}
