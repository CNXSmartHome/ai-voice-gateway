import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PrismaService } from '../database/prisma.service';

import { GATEWAY_SELECT, toGatewayView, type GatewayView } from './gateway.view';

/**
 * Roles permitted to bind hardware to a property.
 *
 * Claiming is an administrative action over physical hardware. `MEMBER`
 * exists for residents and guests, who use a gateway but should not be able
 * to attach one to a property.
 */
export const CLAIM_ROLES: readonly string[] = ['OWNER', 'ADMIN'];

/** Status a gateway must be in to be claimable. */
const CLAIMABLE_STATUS = 'UNCLAIMED';

/**
 * Status a gateway takes on once claimed.
 *
 * Not `ONLINE`: a claim records ownership, it does not mean the hardware has
 * connected. The heartbeat (VG-006) is what moves it to `ONLINE`.
 */
const CLAIMED_STATUS = 'OFFLINE';

export interface ClaimGatewayInput {
  readonly serialNumber: string;
  readonly propertyId: string;
  readonly roomId?: string;
  readonly name?: string;
}

@Injectable()
export class GatewaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claims an unclaimed gateway into a property the caller administers.
   *
   * Every rejection is the same 404. Distinguishing "no such serial" from
   * "already claimed" would let anyone enumerate which serials exist and
   * which are in use, and distinguishing "no such property" from "not your
   * property" would do the same for property ids. The caller learns only
   * that the claim did not apply.
   */
  async claim(caller: AuthenticatedUser, input: ClaimGatewayInput): Promise<GatewayView> {
    return this.prisma.$transaction(async (tx) => {
      // Resolve the property first. A caller who cannot see it must not be
      // able to probe serial numbers against it.
      const property = await tx.property.findUnique({
        where: { id: input.propertyId },
        select: { id: true, organizationId: true },
      });

      if (property === null || !this.mayClaimInto(caller, property.organizationId)) {
        throw claimRejected();
      }

      if (input.roomId !== undefined) {
        const room = await tx.room.findUnique({
          where: { id: input.roomId },
          select: { propertyId: true },
        });

        // A room from another property would put the gateway's voice context
        // in a place it does not physically sit.
        if (room === null || room.propertyId !== property.id) {
          throw claimRejected();
        }
      }

      // The claim itself: one guarded statement. `status = UNCLAIMED` in the
      // WHERE clause is what makes concurrent claims safe -- the loser
      // updates zero rows rather than taking the gateway from the winner.
      // This updates the existing row, so the hardware identity (`id`,
      // `serial_number`, `created_at`) is preserved.
      const claimed = await tx.gateway
        .updateMany({
          where: { serialNumber: input.serialNumber, status: CLAIMABLE_STATUS },
          data: {
            propertyId: property.id,
            roomId: input.roomId ?? null,
            status: CLAIMED_STATUS,
            ...(input.name === undefined ? {} : { name: input.name }),
          },
        })
        .catch((error: unknown) => {
          // The property or room was checked a moment ago but could be
          // deleted before this statement lands. The database catches that as
          // a foreign key violation; the caller gets the same rejection as
          // any other, rather than a 500 carrying schema detail.
          if (isReferentialFailure(error)) throw claimRejected();
          throw error;
        });

      if (claimed.count === 0) {
        // Unknown serial, already claimed, or disabled -- all the same here.
        throw claimRejected();
      }

      const gateway = await tx.gateway.findUniqueOrThrow({
        where: { serialNumber: input.serialNumber },
        select: GATEWAY_SELECT,
      });

      return toGatewayView(gateway);
    });
  }

  /**
   * Records a manufactured gateway, so there is something to claim.
   *
   * Deliberately has no HTTP route: creating unclaimed hardware is a
   * manufacturing intake action, not a customer one. Exposing it would need
   * an operator role and an admin authorization surface that does not exist
   * yet, and inventing one here would be a security-model decision beyond
   * this task. Driven by `scripts/register-gateway.js`.
   */
  async register(input: { serialNumber: string; name?: string }): Promise<GatewayView> {
    const gateway = await this.prisma.gateway.create({
      data: {
        serialNumber: input.serialNumber,
        name: input.name ?? input.serialNumber,
      },
      select: GATEWAY_SELECT,
    });

    return toGatewayView(gateway);
  }

  /**
   * True when the caller holds a claiming role in the owning organization.
   *
   * Reads from the memberships the guard already loaded, so the decision uses
   * the caller's current roles rather than anything carried in their token.
   */
  private mayClaimInto(caller: AuthenticatedUser, organizationId: string): boolean {
    return caller.memberships.some(
      (membership) =>
        membership.organizationId === organizationId && CLAIM_ROLES.includes(membership.role),
    );
  }
}

/** Prisma reports a foreign key violation as P2003 and a missing row as P2025. */
function isReferentialFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;

  const code = (error as { code: unknown }).code;
  return code === 'P2003' || code === 'P2025';
}

/**
 * The single rejection this endpoint produces.
 *
 * One shape for every reason: an unknown serial, a claimed gateway, a
 * property that does not exist, and a property belonging to someone else are
 * all indistinguishable to the caller.
 */
function claimRejected(): NotFoundException {
  return new NotFoundException(
    'No unclaimed gateway matches that serial number for that property.',
  );
}
