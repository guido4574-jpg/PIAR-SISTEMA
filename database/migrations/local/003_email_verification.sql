-- Local schema change for traditional registration email verification.
-- Only adds one nullable column and one new table; existing users/data are retained.
SET @sql = (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE usuario ADD COLUMN correo_verificado_at DATETIME NULL',
        'SELECT 1')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'correo_verificado_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS verificacion_correo (
    id_verificacion BIGINT NOT NULL AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_verificacion),
    UNIQUE KEY uq_verificacion_correo_token_hash (token_hash),
    KEY idx_verificacion_correo_usuario (id_usuario),
    KEY idx_verificacion_correo_expira (expires_at),
    CONSTRAINT fk_verificacion_correo_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
