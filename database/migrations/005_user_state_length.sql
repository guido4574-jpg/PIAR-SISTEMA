-- Widen the account state column for 'pendiente_verificacion' (22 chars).
-- Apply after 001_mvp_core.sql. Additive schema-only change; no rows are changed.
-- Existing columns wider than 30 characters are left untouched.
SET @piar_state_length_sql = (
    SELECT IF(
        MAX(DATA_TYPE) = 'varchar' AND MAX(CHARACTER_MAXIMUM_LENGTH) < 30,
        'ALTER TABLE usuario MODIFY COLUMN estado VARCHAR(30) NOT NULL DEFAULT ''activo''',
        'SELECT 1'
    )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'usuario'
      AND COLUMN_NAME = 'estado'
);
PREPARE piar_state_length_stmt FROM @piar_state_length_sql;
EXECUTE piar_state_length_stmt;
DEALLOCATE PREPARE piar_state_length_stmt;
