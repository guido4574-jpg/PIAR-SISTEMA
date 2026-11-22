-- Additive and re-runnable; required only for the initial administrator flow.
SET @has_password_change_required = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'password_change_required'
);
SET @sql = IF(
    @has_password_change_required = 0,
    'ALTER TABLE usuario ADD COLUMN password_change_required TINYINT(1) NOT NULL DEFAULT 0 AFTER correo_verificado_at',
    'SELECT 1'
);
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
