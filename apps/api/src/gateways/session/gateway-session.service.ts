import { Injectable } from '@nestjs/common';
import type { GatewayStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { GatewaySecretService } from '../gateway-secret.service';

import type { PresentedCredentials } from './gateway-session.protocol';

/** Statuses a gateway may hold a session in, once authenticated. */
const ONLINE: GatewayStatus = 'ONLINE';
const OFFLINE: GatewayStatus = 'OFFLINE';

/**
 * Statuses from which a gateway may open a session.
 *
 * `UNCLAIMED` is excluded: a gateway with no property has no room context, and
 * admitting one would let a manufactured-but-unsold unit connect to the
 * platform. `DISABLED` is excluded because that is what disabling means.
 */
const CONNECTABLE_STATUSES: GatewayStatus[] = [ONLINE, OFFLINE];

/** The authenticated gateway behind a session. */
export interface GatewaySession {
  readonly gatewayId: string;
  readonly serialNumber: string;
  readonly propertyId: string;
  readonly roomId: string | null;
}

@Injectable()
export class GatewaySessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: GatewaySecretService,
  ) {}

  /**
   * Authenticates a connecting gateway and marks it online.
   *
   * Returns null for every failure — unknown serial, wrong secret, no
   * credential issued, unclaimed, disabled. The caller turns all of them into
   * one close frame, so the socket reveals nothing about which serials exist
   * or which are in service.
   */
  async authenticate(presented: PresentedCredentials): Promise<GatewaySession | null> {
    const gateway = await this.prisma.gateway.findUnique({
      where: { serialNumber: presented.serialNumber },
      select: {
        id: true,
        serialNumber: true,
        status: true,
        propertyId: true,
        roomId: true,
        credential: { select: { id: true, secretHash: true } },
      },
    });

    // Covers an unknown serial and a gateway that was never issued a
    // credential; both are the same failure to whoever is connecting.
    if (gateway === null || gateway.credential === null) {
      // Spend the hash anyway, so an unregistered serial does not answer
      // faster than a registered one with a wrong secret.
      this.secrets.hash(presented.secret);
      return null;
    }

    if (!this.secrets.verify(presented.secret, gateway.credential.secretHash)) return null;

    // Ownership is checked after the secret, so a caller without a valid
    // credential learns nothing about a gateway's claim state.
    if (!CONNECTABLE_STATUSES.includes(gateway.status)) return null;
    if (gateway.propertyId === null) return null;

    const { id: gatewayId, propertyId } = gateway;
    const credentialId = gateway.credential.id;

    /*
     * The checks above read a row; this writes one, and an administrator can
     * disable a gateway in between. An unconditional update would then put
     * `DISABLED` back to `ONLINE` — taking a gateway out of service would
     * silently fail against a device that reconnects, which is precisely the
     * situation where someone is relying on it.
     *
     * So the transition carries its own conditions and is refused unless the
     * persisted row still satisfies them. `propertyId` is pinned to the value
     * that was read rather than merely required to be present, so the session
     * this returns cannot describe a property the gateway no longer belongs
     * to. Nothing is written when the guard does not match, and the caller
     * treats that as an authentication failure like any other.
     */
    const session = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.gateway.updateMany({
        where: {
          id: gatewayId,
          status: { in: CONNECTABLE_STATUSES },
          propertyId,
        },
        data: { status: ONLINE, lastSeenAt: new Date() },
      });

      if (transitioned.count !== 1) return null;

      await tx.gatewayCredential.update({
        where: { id: credentialId },
        data: { lastUsedAt: new Date() },
      });

      /*
       * The room is read back here, after the transition, rather than carried
       * from the row read before it.
       *
       * A gateway's room is its voice context: it is what turns "turn on the
       * light" into a specific device, so a session holding the room the
       * gateway was in a moment ago would send commands to the wrong place —
       * and would go on doing it for as long as the session lasted. The guard
       * above pins ownership but says nothing about the room, and a
       * reassignment is not a reason to refuse a connection: it is a reason
       * to use the new room.
       *
       * The update holds a lock on this row until commit, so what is read
       * here cannot change underneath it. Whatever the session carries was
       * true at the moment the gateway came online.
       */
      const current = await tx.gateway.findUniqueOrThrow({
        where: { id: gatewayId },
        select: { serialNumber: true, propertyId: true, roomId: true },
      });

      if (current.propertyId === null) return null;

      return {
        gatewayId,
        serialNumber: current.serialNumber,
        propertyId: current.propertyId,
        roomId: current.roomId,
      };
    });

    return session;
  }

  /**
   * Records a heartbeat.
   *
   * Touches only liveness columns. A heartbeat is the device saying it is
   * still there; it must never be able to move a gateway between properties
   * or rooms, so ownership is not writable from this path.
   *
   * Guarded on the gateway still being `ONLINE`, for the same reason
   * `authenticate` is guarded: a gateway disabled during a live session would
   * otherwise be restored to `ONLINE` by its next heartbeat, and a device
   * that heartbeats every thirty seconds would undo the change faster than
   * anyone could notice it had not taken.
   *
   * Returns false when the gateway is no longer entitled to the session it
   * holds. The caller closes the socket: leaving a disabled gateway with a
   * live connection is the same failure by another route.
   */
  async recordHeartbeat(gatewayId: string, firmwareVersion?: string): Promise<boolean> {
    const updated = await this.prisma.gateway.updateMany({
      where: { id: gatewayId, status: ONLINE },
      data: {
        lastSeenAt: new Date(),
        ...(firmwareVersion === undefined ? {} : { firmwareVersion }),
      },
    });

    return updated.count === 1;
  }

  /**
   * Marks a gateway offline when its session ends.
   *
   * Guarded on the gateway still being `ONLINE`, so a disconnect cannot
   * resurrect a gateway that was `DISABLED` while it was connected. Taking a
   * gateway out of service must survive it dropping its socket.
   *
   * The reconnect race — an old socket closing after a new one is already
   * established — is handled by the connection registry in
   * `GatewaySessionServer`, which only calls this for the socket it still
   * holds as current.
   */
  async markOffline(gatewayId: string): Promise<void> {
    await this.prisma.gateway.updateMany({
      where: { id: gatewayId, status: ONLINE },
      data: { status: OFFLINE },
    });
  }
}
