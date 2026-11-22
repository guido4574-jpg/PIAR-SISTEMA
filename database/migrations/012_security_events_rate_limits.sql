-- Additive and re-runnable.
-- 1. Shared rate-limit counters (RATE_LIMIT_STORE=mysql). clave is the
--    SHA-256 of the bucket name and key, so no IP or email is stored.
CREATE TABLE IF NOT EXISTS limite_solicitudes (
    clave CHAR(64) NOT NULL,
    conteo INT UNSIGNED NOT NULL DEFAULT 1,
    expira_at DATETIME(3) NOT NULL,
    PRIMARY KEY (clave),
    KEY idx_limite_solicitudes_expira (expira_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Authentication and security events. No FK to usuario on purpose: the
--    trail must survive account changes. Emails are hashed and addresses
--    truncated to their network prefix.
CREATE TABLE IF NOT EXISTS evento_seguridad (
    id_evento BIGINT NOT NULL AUTO_INCREMENT,
    tipo VARCHAR(40) NOT NULL,
    resultado VARCHAR(16) NOT NULL,
    id_usuario INT NULL,
    correo_hash CHAR(64) NULL,
    red_origen VARCHAR(50) NULL,
    detalle VARCHAR(120) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_evento),
    KEY idx_evento_seguridad_fecha (created_at),
    KEY idx_evento_seguridad_tipo_fecha (tipo, created_at),
    KEY idx_evento_seguridad_usuario_fecha (id_usuario, created_at),
    KEY idx_evento_seguridad_correo_fecha (correo_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. docente.documento must accept the same length as usuario.documento
--    (VARCHAR(30)); otherwise approving a registration can fail.
SET @docente_documento_length = (
    SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'docente' AND COLUMN_NAME = 'documento'
);
SET @sql = IF(
    @docente_documento_length IS NOT NULL AND @docente_documento_length < 30,
    'ALTER TABLE docente MODIFY COLUMN documento VARCHAR(30) NULL',
    'SELECT 1'
);
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
