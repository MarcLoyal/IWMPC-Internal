-- The go-live cleanup was removed, so the audit log now has no exception at all: it can never be
-- emptied. Only the automated test database (iwmpc_test) may empty itself, when the tests ask.
CREATE OR REPLACE FUNCTION audit_log_no_truncate() RETURNS trigger AS $$
BEGIN
  IF current_database() = 'iwmpc_test' AND current_setting('iwmpc.test_reset', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'The audit log cannot be emptied.';
END;
$$ LANGUAGE plpgsql;
