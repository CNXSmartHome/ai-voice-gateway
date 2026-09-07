CREATE TYPE "service_request_source" AS ENUM ('GUEST_WEB', 'VOICE', 'STAFF', 'ADMIN', 'AUTOMATION');
CREATE TYPE "service_request_status" AS ENUM ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED');

CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_id" TEXT,
    "source_gateway_id" TEXT,
    "created_by_user_id" TEXT,
    "source" "service_request_source" NOT NULL,
    "status" "service_request_status" NOT NULL DEFAULT 'NEW',
    "category" TEXT NOT NULL,
    "note" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_request_items" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "service_request_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "from_status" "service_request_status",
    "to_status" "service_request_status" NOT NULL,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_requests_public_id_key" ON "service_requests"("public_id");
CREATE UNIQUE INDEX "service_requests_property_id_idempotency_key_key" ON "service_requests"("property_id", "idempotency_key");
CREATE INDEX "service_requests_property_id_status_created_at_idx" ON "service_requests"("property_id", "status", "created_at");
CREATE INDEX "service_requests_room_id_idx" ON "service_requests"("room_id");
CREATE INDEX "service_requests_source_gateway_id_idx" ON "service_requests"("source_gateway_id");
CREATE INDEX "service_request_items_request_id_idx" ON "service_request_items"("request_id");
CREATE INDEX "service_request_events_request_id_created_at_idx" ON "service_request_events"("request_id", "created_at");

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_source_gateway_id_fkey" FOREIGN KEY ("source_gateway_id") REFERENCES "gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_request_items" ADD CONSTRAINT "service_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_request_items" ADD CONSTRAINT "service_request_items_quantity_positive" CHECK ("quantity" > 0);
