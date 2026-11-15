-- AlterTable
ALTER TABLE "products" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'RICE';

-- Existing products: anything named LPG is LPG; the rest are rice.
UPDATE "products" SET "category" = 'LPG' WHERE "name" ILIKE '%lpg%';
