-- Runs only during first initialization of a fresh local test datadir.
-- Remove inherited/global/schema grants before granting the runner only DML.
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'piar_test'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `piar_test`.* TO 'piar_test'@'%';
