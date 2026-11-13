-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'WATER_BILL';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "water_bill_id" INTEGER;

-- AlterTable
ALTER TABLE "water_connections" ADD COLUMN     "initial_reading" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "rate_class" SET DEFAULT 'RESIDENTIAL';

-- CreateTable
CREATE TABLE "rate_schedules" (
    "id" SERIAL NOT NULL,
    "rate_class" TEXT NOT NULL,
    "effective_from" TEXT NOT NULL,
    "minimum_charge" DECIMAL(12,2) NOT NULL,
    "minimum_covers_m3" INTEGER NOT NULL,
    "tiers" JSONB NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BLOCK',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,

    CONSTRAINT "rate_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" SERIAL NOT NULL,
    "connection_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "previous_reading" INTEGER NOT NULL,
    "current_reading" INTEGER NOT NULL,
    "read_date" DATE NOT NULL,
    "entered_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_bills" (
    "id" SERIAL NOT NULL,
    "connection_id" INTEGER NOT NULL,
    "reading_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "cubic_meters" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "penalty_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bill_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "rate_schedule_id" INTEGER NOT NULL,
    "settled_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_schedules_rate_class_effective_from_key" ON "rate_schedules"("rate_class", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_connection_id_period_key" ON "meter_readings"("connection_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "water_bills_reading_id_key" ON "water_bills"("reading_id");

-- CreateIndex
CREATE INDEX "water_bills_settled_on_idx" ON "water_bills"("settled_on");

-- CreateIndex
CREATE INDEX "water_bills_period_idx" ON "water_bills"("period");

-- CreateIndex
CREATE UNIQUE INDEX "water_bills_connection_id_period_key" ON "water_bills"("connection_id", "period");

-- CreateIndex
CREATE INDEX "payments_water_bill_id_idx" ON "payments"("water_bill_id");

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "water_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "water_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_rate_schedule_id_fkey" FOREIGN KEY ("rate_schedule_id") REFERENCES "rate_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_water_bill_id_fkey" FOREIGN KEY ("water_bill_id") REFERENCES "water_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rate class is now stored as a code.
UPDATE "water_connections" SET "rate_class" = 'RESIDENTIAL' WHERE "rate_class" NOT IN ('RESIDENTIAL', 'COMMERCIAL');
