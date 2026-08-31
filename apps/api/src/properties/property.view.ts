/**
 * What a caller may see about a property.
 *
 * An explicit allow-list rather than a loaded row, for the same reason
 * `gateway.view.ts` is one: a column added later is excluded by default
 * instead of leaking until someone remembers to filter it.
 */
export interface PropertyView {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly timezone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The columns {@link toPropertyView} needs, as a Prisma `select`. */
export const PROPERTY_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface PropertyRow {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toPropertyView(property: PropertyRow): PropertyView {
  return {
    id: property.id,
    organizationId: property.organizationId,
    name: property.name,
    timezone: property.timezone,
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
  };
}
