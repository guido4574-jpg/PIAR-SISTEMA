-- Local, additive migration for the PIAR password recovery flow.
-- Apply only while connected to the verified local database piar_test.
-- This script creates one missing table and does not modify existing tables or rows.

CREATE TABLE IF NOT EXISTS recuperacion_contrasena (
    id_recuperacion BIGINT NOT NULL AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_recuperacion),
    UNIQUE KEY uq_recuperacion_token_hash (token_hash),
    KEY idx_recuperacion_usuario (id_usuario),
    KEY idx_recuperacion_expira (expires_at),
    CONSTRAINT fk_recuperacion_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
