import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { GatewaySecretService } from '../gateway-secret.service';

import type { PresentedCredentials } from './gateway-session.protocol';

/** Statuses a gateway may hold a session in, once authenticated. */
const ONLINE = 'ONLINE';
const OFFLINE = 'OFFLINE';

/**
 * Statuses from which a gateway may open a session.
 *
 * `UNCLAIMED` is excluded: a gateway with no property has no room context, and
 * admitting one would let a manufactured-but-unsold unit connect to the
 * platform. `DISABLED` is excluded because that is what disabling means.
 */
const CONNECTABLE_STATUSES = [ONLINE, OFFLINE];

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

    await this.prisma.$transaction([
      this.prisma.gateway.update({
        where: { id: gateway.id },
        data: { status: ONLINE, lastSeenAt: new Date() },
      }),
      this.prisma.gatewayCredential.update({
        where: { id: gateway.credential.id },
        data: { lastUsedAt: new Date() },
      }),
    ]);

    return {
      gatewayId: gateway.id,
      serialNumber: gateway.serialNumber,
      propertyId: gateway.propertyId,
      roomId: gateway.roomId,
    };
  }

  /**
   * Records a heartbeat.
   *
   * Touches only liveness columns. A heartbeat is the device saying it is
   * still there; it must never be able to move a gateway between properties
   * or rooms, so ownership is not writable from this path.
   */
  async recordHeartbeat(gatewayId: string, firmwareVersion?: string): Promise<void> {
    await this.prisma.gateway.update({
      where: { id: gatewayId },
      data: {
        lastSeenAt: new Date(),
        status: ONLINE,
        ...(firmwareVersion === undefined ? {} : { firmwareVersion }),
      },
    });
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
