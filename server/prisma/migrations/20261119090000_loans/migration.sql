-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('FOR_APPROVAL', 'APPROVED', 'RELEASED', 'PAID', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'LOAN';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'LOAN_OFFICER';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "opening_share_capital" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "loan_id" INTEGER;

-- CreateTable
CREATE TABLE "loan_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_rate" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "method" TEXT NOT NULL DEFAULT 'DIMINISHING_EQUAL',
    "min_months" INTEGER NOT NULL DEFAULT 1,
    "max_months" INTEGER NOT NULL DEFAULT 12,
    "service_charge_percent" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "tsc_type" TEXT NOT NULL DEFAULT 'AMOUNT',
    "tsc_value" DECIMAL(12,2) NOT NULL DEFAULT 30,
    "notarial_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_charge_label" TEXT NOT NULL DEFAULT '',
    "other_charge_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "penalty_type" TEXT NOT NULL DEFAULT 'NONE',
    "penalty_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_type_changes" (
    "id" SERIAL NOT NULL,
    "loan_type_id" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by" INTEGER,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_type_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "loan_type_id" INTEGER NOT NULL,
    "type_name" TEXT NOT NULL,
    "monthly_rate" DECIMAL(6,2) NOT NULL,
    "method" TEXT NOT NULL,
    "penalty_type" TEXT NOT NULL,
    "penalty_value" DECIMAL(12,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "monthly_payment" DECIMAL(12,2) NOT NULL,
    "total_interest" DECIMAL(12,2) NOT NULL,
    "total_deductions" DECIMAL(12,2) NOT NULL,
    "net_cash" DECIMAL(12,2) NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "limit_at_apply" DECIMAL(12,2) NOT NULL,
    "over_limit_reason" TEXT,
    "status" "LoanStatus" NOT NULL DEFAULT 'FOR_APPROVAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by" INTEGER,
    "reject_reason" TEXT,
    "release_date" DATE,
    "cash_given" DECIMAL(12,2),
    "released_at" TIMESTAMP(3),
    "released_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancel_reason" TEXT,
    "paid_on" DATE,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_installments" (
    "id" SERIAL NOT NULL,
    "loan_id" INTEGER NOT NULL,
    "no" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "interest" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_deductions" (
    "id" SERIAL NOT NULL,
    "loan_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "loan_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_payment_lines" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "loan_id" INTEGER NOT NULL,
    "installment_id" INTEGER NOT NULL,
    "penalty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "principal" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "loan_payment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_types_name_key" ON "loan_types"("name");

-- CreateIndex
CREATE INDEX "loan_type_changes_loan_type_id_idx" ON "loan_type_changes"("loan_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "loans_number_key" ON "loans"("number");

-- CreateIndex
CREATE INDEX "loans_account_id_idx" ON "loans"("account_id");

-- CreateIndex
CREATE INDEX "loans_status_idx" ON "loans"("status");

-- CreateIndex
CREATE INDEX "loan_installments_due_date_idx" ON "loan_installments"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "loan_installments_loan_id_no_key" ON "loan_installments"("loan_id", "no");

-- CreateIndex
CREATE INDEX "loan_deductions_loan_id_idx" ON "loan_deductions"("loan_id");

-- CreateIndex
CREATE INDEX "loan_payment_lines_loan_id_idx" ON "loan_payment_lines"("loan_id");

-- CreateIndex
CREATE INDEX "loan_payment_lines_payment_id_idx" ON "loan_payment_lines"("payment_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_type_changes" ADD CONSTRAINT "loan_type_changes_loan_type_id_fkey" FOREIGN KEY ("loan_type_id") REFERENCES "loan_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_type_changes" ADD CONSTRAINT "loan_type_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_loan_type_id_fkey" FOREIGN KEY ("loan_type_id") REFERENCES "loan_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_deductions" ADD CONSTRAINT "loan_deductions_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_payment_lines" ADD CONSTRAINT "loan_payment_lines_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_payment_lines" ADD CONSTRAINT "loan_payment_lines_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_payment_lines" ADD CONSTRAINT "loan_payment_lines_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "loan_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

