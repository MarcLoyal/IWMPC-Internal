-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "BoardDecision" AS ENUM ('APPROVED', 'DISAPPROVED');

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'SHARE_CAPITAL';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "barangay" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "board_decision" "BoardDecision",
ADD COLUMN     "board_decision_date" DATE,
ADD COLUMN     "education" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "first_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "last_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "membership_applied_on" DATE,
ADD COLUMN     "membership_purpose" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "meter_registered_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "middle_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "municipality" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pmes_attended" BOOLEAN,
ADD COLUMN     "province" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "purok" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "religion" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sex" "Sex",
ADD COLUMN     "shares_amount" DECIMAL(12,2),
ADD COLUMN     "shares_subscribed" INTEGER,
ADD COLUMN     "tin" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "water_connections" ADD COLUMN     "application_date" DATE,
ADD COLUMN     "meter_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "meter_serial" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "remarks" TEXT NOT NULL DEFAULT '';

-- Fill the new name and address parts for accounts that already exist (best effort:
-- last word = family name, the rest = given name; first part of the address = purok / sitio).
UPDATE "accounts" SET
  "last_name"  = CASE WHEN position(' ' in btrim("full_name")) > 0 THEN regexp_replace(btrim("full_name"), '^.*\s', '') ELSE btrim("full_name") END,
  "first_name" = CASE WHEN position(' ' in btrim("full_name")) > 0 THEN regexp_replace(btrim("full_name"), '\s+\S+$', '') ELSE '' END,
  "purok" = btrim(split_part("address", ',', 1)),
  "barangay" = 'Inicbulan', "municipality" = 'Bauan', "province" = 'Batangas'
WHERE "last_name" = '';

UPDATE "water_connections" SET "application_date" = "created_at"::date WHERE "application_date" IS NULL;
