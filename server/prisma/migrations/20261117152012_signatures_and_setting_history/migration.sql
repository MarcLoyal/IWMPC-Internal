-- CreateTable
CREATE TABLE "setting_changes" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "changed_by" INTEGER,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setting_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_images" (
    "id" SERIAL NOT NULL,
    "slot" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "data" BYTEA,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "setting_changes_key_idx" ON "setting_changes"("key");

-- CreateIndex
CREATE UNIQUE INDEX "signature_images_slot_key" ON "signature_images"("slot");

-- AddForeignKey
ALTER TABLE "setting_changes" ADD CONSTRAINT "setting_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_images" ADD CONSTRAINT "signature_images_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The monthly bill's billing officer, as spelled on IWMPC's form (only if still the earlier default).
UPDATE "settings" SET "value" = 'Alffa M. Mahiya' WHERE "key" = 'bill_preparer_name' AND "value" = 'Alfa M. Mahiya';
