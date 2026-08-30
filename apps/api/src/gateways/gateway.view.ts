/**
 * What a caller may see about a gateway.
 *
 * Built as an explicit allow-list rather than by returning a loaded row, so a
 * column added to `Gateway` later — a device credential, an internal flag —
 * is excluded by default instead of leaking until someone remembers to
 * filter it. `docs/ARCHITECTURE.md` requires that Tuya credentials never
 * reach the gateway; nothing about the gateway record should reach a client
 * that has not been chosen deliberately either.
 */
export interface GatewayView {
  readonly id: string;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: string;
  readonly propertyId: string | null;
  readonly roomId: string | null;
  readonly firmwareVersion: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The columns {@link toGatewayView} needs, as a Prisma `select`. */
export const GATEWAY_SELECT = {
  id: true,
  serialNumber: true,
  name: true,
  status: true,
  propertyId: true,
  roomId: true,
  firmwareVersion: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface GatewayRow {
  id: string;
  serialNumber: string;
  name: string;
  status: string;
  propertyId: string | null;
  roomId: string | null;
  firmwareVersion: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toGatewayView(gateway: GatewayRow): GatewayView {
  return {
    id: gateway.id,
    serialNumber: gateway.serialNumber,
    name: gateway.name,
    status: gateway.status,
    propertyId: gateway.propertyId,
    roomId: gateway.roomId,
    firmwareVersion: gateway.firmwareVersion,
    lastSeenAt: gateway.lastSeenAt?.toISOString() ?? null,
    createdAt: gateway.createdAt.toISOString(),
    updatedAt: gateway.updatedAt.toISOString(),
  };
}
