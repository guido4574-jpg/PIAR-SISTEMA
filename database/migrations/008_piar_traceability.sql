-- Add structured barrier, adjustment, evidence, and follow-up traceability.
-- Additive only: legacy PIAR text and rows remain intact. Do not auto-convert free text.

CREATE TABLE IF NOT EXISTS piar_barrera (
    id_barrera INT NOT NULL AUTO_INCREMENT,
    id_piar INT NOT NULL,
    contexto VARCHAR(40) NOT NULL,
    descripcion TEXT NOT NULL,
    actividad TEXT NULL,
    condicion_entorno TEXT NULL,
    fecha_identificacion DATE NOT NULL,
    id_usuario_registro INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_barrera),
    UNIQUE KEY uq_piar_barrera_contexto (id_piar, id_barrera),
    KEY idx_piar_barrera_piar (id_piar),
    CONSTRAINT fk_piar_barrera_piar FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_piar_barrera_usuario FOREIGN KEY (id_usuario_registro) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND COLUMN_NAME = 'id_barrera') = 0,
    'ALTER TABLE piar_ajuste ADD COLUMN id_barrera INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND COLUMN_NAME = 'id_usuario_responsable') = 0,
    'ALTER TABLE piar_ajuste ADD COLUMN id_usuario_responsable INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND COLUMN_NAME = 'resultado_esperado') = 0,
    'ALTER TABLE piar_ajuste ADD COLUMN resultado_esperado TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND COLUMN_NAME = 'indicador_logro') = 0,
    'ALTER TABLE piar_ajuste ADD COLUMN indicador_logro TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND COLUMN_NAME = 'fecha_revision_prevista') = 0,
    'ALTER TABLE piar_ajuste ADD COLUMN fecha_revision_prevista DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND INDEX_NAME = 'uq_piar_ajuste_contexto') = 0,
    'ALTER TABLE piar_ajuste ADD UNIQUE KEY uq_piar_ajuste_contexto (id_piar, id_ajuste)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND CONSTRAINT_NAME = 'fk_piar_ajuste_barrera') = 0,
    'ALTER TABLE piar_ajuste ADD CONSTRAINT fk_piar_ajuste_barrera FOREIGN KEY (id_piar, id_barrera) REFERENCES piar_barrera (id_piar, id_barrera)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'piar_ajuste' AND CONSTRAINT_NAME = 'fk_piar_ajuste_responsable') = 0,
    'ALTER TABLE piar_ajuste ADD CONSTRAINT fk_piar_ajuste_responsable FOREIGN KEY (id_usuario_responsable) REFERENCES usuario (id_usuario)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS piar_ajuste_evidencia (
    id_evidencia INT NOT NULL AUTO_INCREMENT,
    id_ajuste INT NOT NULL,
    descripcion TEXT NOT NULL,
    referencia VARCHAR(500) NULL,
    fecha DATE NOT NULL,
    id_usuario_autor INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_evidencia),
    KEY idx_piar_evidencia_ajuste (id_ajuste),
    KEY idx_piar_evidencia_autor (id_usuario_autor),
    CONSTRAINT fk_piar_evidencia_ajuste FOREIGN KEY (id_ajuste) REFERENCES piar_ajuste (id_ajuste),
    CONSTRAINT fk_piar_evidencia_usuario FOREIGN KEY (id_usuario_autor) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seguimiento' AND COLUMN_NAME = 'id_ajuste') = 0,
    'ALTER TABLE seguimiento ADD COLUMN id_ajuste INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seguimiento' AND INDEX_NAME = 'idx_seguimiento_ajuste') = 0,
    'ALTER TABLE seguimiento ADD KEY idx_seguimiento_ajuste (id_ajuste)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'seguimiento' AND CONSTRAINT_NAME = 'fk_seguimiento_ajuste') = 0,
    'ALTER TABLE seguimiento ADD CONSTRAINT fk_seguimiento_ajuste FOREIGN KEY (id_piar, id_ajuste) REFERENCES piar_ajuste (id_piar, id_ajuste)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
