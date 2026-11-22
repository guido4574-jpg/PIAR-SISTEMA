-- Additive and re-runnable. Existing rows are untouched.
-- Institutional decision: the Estudiante role has read-only access to its own
-- PIAR only. The account is bound to exactly one student record through
-- estudiante.id_usuario (unique), so the API derives the scope from the session
-- and never from a client-supplied identifier.

-- Preserve every existing enum value and add Estudiante.
SET @sql = (
    SELECT IF(COLUMN_TYPE LIKE '%Estudiante%',
        'SELECT 1',
        'ALTER TABLE usuario MODIFY COLUMN rol ENUM(''Docente'',''Psicóloga'',''Coordinador'',''Administrador'',''Rector'',''Estudiante'') NOT NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'rol'
);
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estudiante' AND COLUMN_NAME = 'id_usuario');
SET @sql = IF(@has_column = 0, 'ALTER TABLE estudiante ADD COLUMN id_usuario INT NULL AFTER id_estudiante', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

-- One account per student record and one student record per account.
SET @has_index = (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estudiante' AND INDEX_NAME = 'uq_estudiante_usuario');
SET @sql = IF(@has_index = 0, 'ALTER TABLE estudiante ADD UNIQUE KEY uq_estudiante_usuario (id_usuario)', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estudiante' AND CONSTRAINT_NAME = 'fk_estudiante_usuario');
SET @sql = IF(@has_fk = 0, 'ALTER TABLE estudiante ADD CONSTRAINT fk_estudiante_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
