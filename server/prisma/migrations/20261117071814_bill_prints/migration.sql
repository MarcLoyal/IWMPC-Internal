-- CreateTable
CREATE TABLE "bill_prints" (
    "id" SERIAL NOT NULL,
    "water_bill_id" INTEGER NOT NULL,
    "printed_by" INTEGER NOT NULL,
    "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_prints_water_bill_id_idx" ON "bill_prints"("water_bill_id");

-- AddForeignKey
ALTER TABLE "bill_prints" ADD CONSTRAINT "bill_prints_water_bill_id_fkey" FOREIGN KEY ("water_bill_id") REFERENCES "water_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_prints" ADD CONSTRAINT "bill_prints_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
