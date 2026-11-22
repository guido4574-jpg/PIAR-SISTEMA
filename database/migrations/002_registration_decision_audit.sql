-- Add decision metadata for institutionally approved teacher accounts.
-- Apply after 001_mvp_core.sql. The fresh local test container mounts this after 001.
SET @has_approved_by = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'aprobado_por_usuario_id');
SET @sql = IF(@has_approved_by = 0, 'ALTER TABLE usuario ADD COLUMN aprobado_por_usuario_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_rejected_by = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'rechazado_por_usuario_id');
SET @sql = IF(@has_rejected_by = 0, 'ALTER TABLE usuario ADD COLUMN rechazado_por_usuario_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_decision_at = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'decision_at');
SET @sql = IF(@has_decision_at = 0, 'ALTER TABLE usuario ADD COLUMN decision_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_approved_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND CONSTRAINT_NAME = 'fk_usuario_aprobado_por');
SET @sql = IF(@has_approved_fk = 0, 'ALTER TABLE usuario ADD CONSTRAINT fk_usuario_aprobado_por FOREIGN KEY (aprobado_por_usuario_id) REFERENCES usuario (id_usuario)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_rejected_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND CONSTRAINT_NAME = 'fk_usuario_rechazado_por');
SET @sql = IF(@has_rejected_fk = 0, 'ALTER TABLE usuario ADD CONSTRAINT fk_usuario_rechazado_por FOREIGN KEY (rechazado_por_usuario_id) REFERENCES usuario (id_usuario)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
