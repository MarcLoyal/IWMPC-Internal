-- The audit log can only be added to. Changing or deleting an entry is refused by the database
-- itself, whoever asks (the app, a script, or someone connected to the database).
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- For "everything this person did", newest first.
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");
