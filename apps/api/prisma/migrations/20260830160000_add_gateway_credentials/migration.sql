-- CreateTable
CREATE TABLE "gateway_credentials" (
    "id" TEXT NOT NULL,
    "gateway_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_credentials_gateway_id_key" ON "gateway_credentials"("gateway_id");

-- AddForeignKey
ALTER TABLE "gateway_credentials" ADD CONSTRAINT "gateway_credentials_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

