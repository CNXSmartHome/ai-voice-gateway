import type { Capability as DbCapability, DeviceType as DbDeviceType } from '@prisma/client';
import type { Capability, ResourceKind } from '@vg/domain';

import { toDomainCapability, toDomainDeviceType } from '../database/domain-mapping';

/**
 * What a caller may see about a resource.
 *
 * An explicit allow-list, like `GATEWAY_SELECT`, and for a sharper reason
 * here: the provider binding is the one thing this model holds that must
 * never leave the process. `docs/ARCHITECTURE.md` requires that the AI never
 * address a platform directly, and it cannot address what it has not been
 * told the identifier of.
 *
 * So neither `platform` nor `externalId` appears below, and
 * {@link RESOURCE_SELECT} does not select the `binding` relation at all. The
 * omission is structural rather than a filter applied on the way out: a
 * column added to `ResourceBinding` later is excluded by default instead of
 * leaking until someone remembers it.
 *
 * `platform` is withheld as well as `externalId` because a caller that can
 * branch on the platform has already lost provider independence, even if it
 * cannot name the device.
 */
export interface ResourceView {
  readonly id: string;
  readonly propertyId: string;
  readonly roomId: string | null;
  readonly name: string;
  readonly kind: ResourceKind;
  readonly capabilities: readonly Capability[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The columns {@link toResourceView} needs, as a Prisma `select`. */
export const RESOURCE_SELECT = {
  id: true,
  propertyId: true,
  roomId: true,
  name: true,
  kind: true,
  capabilities: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * A selected row, in storage terms.
 *
 * Enums arrive SCREAMING_SNAKE_CASE from Postgres and are translated on the
 * way out, so the canonical names in `docs/DEVICE_MODEL.md` are the only ones
 * a caller ever sees.
 */
export interface ResourceRow {
  id: string;
  propertyId: string;
  roomId: string | null;
  name: string;
  kind: DbDeviceType;
  capabilities: readonly DbCapability[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toResourceView(resource: ResourceRow): ResourceView {
  return {
    id: resource.id,
    propertyId: resource.propertyId,
    roomId: resource.roomId,
    name: resource.name,
    kind: toDomainDeviceType(resource.kind),
    capabilities: resource.capabilities.map(toDomainCapability),
    enabled: resource.enabled,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
  };
}
