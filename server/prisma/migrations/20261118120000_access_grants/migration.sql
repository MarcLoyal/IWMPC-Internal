-- CreateTable
CREATE TABLE "access_grants" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "work" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ends_on" DATE,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" INTEGER NOT NULL,
    "removed_at" TIMESTAMP(3),
    "removed_by" INTEGER,
    "remove_reason" TEXT,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_grants_user_id_removed_at_idx" ON "access_grants"("user_id", "removed_at");

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Grants are closed (removed_at), never deleted, so the history of who had what stays complete.
CREATE OR REPLACE FUNCTION access_grants_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Extra access records cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER access_grants_no_delete
  BEFORE DELETE ON "access_grants"
  FOR EACH ROW EXECUTE FUNCTION access_grants_no_delete();
