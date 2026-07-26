-- Wipe everything. Run before 001_schema.sql for a clean, reproducible database.
-- Separate from the migration so the migration reads as a schema definition
-- rather than a script with a destructive first line.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO ottodot;
GRANT ALL ON SCHEMA public TO public;
