-- Emptying the whole audit log at once (TRUNCATE) is refused too, like editing or deleting entries.
-- The one exception is the go-live cleanup, once: it must ask for it inside its own transaction, and
-- only while the log has no go-live entry. After go-live, the log can never be emptied again.
-- The automated tests empty their own database (iwmpc_test) before each test, and only there.
CREATE OR REPLACE FUNCTION audit_log_no_truncate() RETURNS trigger AS $$
BEGIN
  IF current_database() = 'iwmpc_test' AND current_setting('iwmpc.test_reset', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF current_setting('iwmpc.go_live_cleanup', true) = 'on'
     AND NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'system.go-live') THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'The audit log cannot be emptied.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();
