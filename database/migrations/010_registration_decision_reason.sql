-- Additive field used to retain the institutional rejection reason.
-- Safe to re-run when the column already exists; this migration is not executed automatically.
SET @has_decision_reason = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'decision_reason'
);
SET @sql = IF(
    @has_decision_reason = 0,
    'ALTER TABLE usuario ADD COLUMN decision_reason VARCHAR(500) NULL AFTER decision_at',
    'SELECT 1'
);
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
