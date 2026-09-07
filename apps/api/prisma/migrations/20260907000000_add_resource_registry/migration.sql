-- VG-040: the resource registry and its provider bindings.
--
-- Additive only. No existing table, column, or constraint is altered, so the
-- VG-003 hierarchy and everything built on it are untouched: this migration is
-- safe to apply to a populated database and rolls forward without a backfill.
--
-- `ALTER TYPE ... ADD VALUE` is permitted inside a transaction on PostgreSQL
-- 12 and later provided the new value is not *used* in the same transaction.
-- Nothing below references 'HOME_ASSISTANT', so this runs under Prisma's
-- per-migration transaction as written.

-- AlterEnum
ALTER TYPE "platform" ADD VALUE 'HOME_ASSISTANT';

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" "device_type" NOT NULL,
    "capabilities" "capability"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_bindings" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "platform" "platform" NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resources_property_id_idx" ON "resources"("property_id");

-- CreateIndex
CREATE INDEX "resources_room_id_idx" ON "resources"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_property_id_room_id_kind_name_key" ON "resources"("property_id", "room_id", "kind", "name");

-- The constraint above does not cover a resource that has no room.
--
-- PostgreSQL treats NULLs as distinct in a UNIQUE index, so two rows with
-- `room_id IS NULL` and the same property, kind, and name both satisfy it --
-- which is exactly the indistinguishable duplicate registration is supposed
-- to reject. Nothing downstream is unsafe, because the resolver reports
-- AMBIGUOUS rather than choosing between them, but the database invariant
-- was incomplete and the ambiguity was unfixable: no target a caller can
-- express distinguishes the two rows.
--
-- A partial index over the same columns closes it. Written by hand because
-- Prisma 6.12 can express neither a partial index nor NULLS NOT DISTINCT in
-- schema.prisma. Split into two indexes rather than one `NULLS NOT DISTINCT`
-- constraint so that the index Prisma does generate stays byte-for-byte what
-- Prisma would generate, and only this one is outside the schema language.
--
-- `prisma-schema-contract.spec.ts` asserts this index is still here, so a
-- future `prisma migrate dev` that offers to drop it fails CI instead.
CREATE UNIQUE INDEX "resources_property_id_kind_name_unassigned_key"
    ON "resources"("property_id", "kind", "name")
    WHERE "room_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "resource_bindings_resource_id_key" ON "resource_bindings"("resource_id");

-- CreateIndex
CREATE INDEX "resource_bindings_property_id_idx" ON "resource_bindings"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_bindings_property_id_platform_external_id_key" ON "resource_bindings"("property_id", "platform", "external_id");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bindings" ADD CONSTRAINT "resource_bindings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

