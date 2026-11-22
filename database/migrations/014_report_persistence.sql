-- Additive and re-runnable. Existing rows are untouched (all new columns are NULL).
-- Persists generated reports: student and PIAR link, period, a server-built
-- content snapshot (historic reports are shown exactly as generated) and a
-- content hash used to avoid accidental duplicates.

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND COLUMN_NAME = 'id_estudiante');
SET @sql = IF(@has_column = 0, 'ALTER TABLE reporte ADD COLUMN id_estudiante INT NULL AFTER id_piar', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND COLUMN_NAME = 'periodo');
SET @sql = IF(@has_column = 0, 'ALTER TABLE reporte ADD COLUMN periodo VARCHAR(50) NULL AFTER tipo', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND COLUMN_NAME = 'contenido');
SET @sql = IF(@has_column = 0, 'ALTER TABLE reporte ADD COLUMN contenido JSON NULL AFTER filtros', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND COLUMN_NAME = 'contenido_hash');
SET @sql = IF(@has_column = 0, 'ALTER TABLE reporte ADD COLUMN contenido_hash CHAR(64) NULL AFTER contenido', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_index = (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND INDEX_NAME = 'idx_reporte_estudiante');
SET @sql = IF(@has_index = 0, 'ALTER TABLE reporte ADD KEY idx_reporte_estudiante (id_estudiante, created_at)', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_index = (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND INDEX_NAME = 'idx_reporte_dedupe');
SET @sql = IF(@has_index = 0, 'ALTER TABLE reporte ADD KEY idx_reporte_dedupe (id_usuario, id_piar, contenido_hash, created_at)', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND CONSTRAINT_NAME = 'fk_reporte_estudiante');
SET @sql = IF(@has_fk = 0, 'ALTER TABLE reporte ADD CONSTRAINT fk_reporte_estudiante FOREIGN KEY (id_estudiante) REFERENCES estudiante (id_estudiante)', 'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
