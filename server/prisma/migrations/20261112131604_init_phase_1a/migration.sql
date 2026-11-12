-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CASHIER', 'STAFF', 'BOARD');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('NONE', 'PENDING', 'MEMBER');

-- CreateEnum
CREATE TYPE "CivilStatus" AS ENUM ('SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING_INSTALLATION', 'ACTIVE', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "account_number" TEXT NOT NULL,
    "member_number" TEXT,
    "full_name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "area_id" INTEGER NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "birth_date" DATE,
    "civil_status" "CivilStatus",
    "id_type" TEXT NOT NULL DEFAULT '',
    "id_number" TEXT NOT NULL DEFAULT '',
    "is_member" BOOLEAN NOT NULL DEFAULT false,
    "membership_status" "MembershipStatus" NOT NULL DEFAULT 'NONE',
    "member_since" DATE,
    "membership_class" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_connections" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "connection_number" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "rate_class" TEXT NOT NULL DEFAULT 'Residential',
    "installation_date" DATE,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING_INSTALLATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "or_number" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "connection_id" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "void_reason" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "areas_name_key" ON "areas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_account_number_key" ON "accounts"("account_number");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_member_number_key" ON "accounts"("member_number");

-- CreateIndex
CREATE INDEX "accounts_full_name_idx" ON "accounts"("full_name");

-- CreateIndex
CREATE INDEX "accounts_area_id_idx" ON "accounts"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "water_connections_connection_number_key" ON "water_connections"("connection_number");

-- CreateIndex
CREATE INDEX "water_connections_account_id_idx" ON "water_connections"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_or_number_key" ON "payments"("or_number");

-- CreateIndex
CREATE INDEX "payments_account_id_idx" ON "payments"("account_id");

-- CreateIndex
CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_connections" ADD CONSTRAINT "water_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "water_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
