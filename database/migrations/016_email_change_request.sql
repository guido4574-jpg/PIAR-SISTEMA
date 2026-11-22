-- Additive and re-runnable. Existing rows are untouched.
-- Decision D1 (2026-11-21): an Administrador may request an email change, but
-- the current address stays valid until the new one is verified through a
-- single-use link. Only the SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS cambio_correo (
    id_cambio BIGINT NOT NULL AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    correo_nuevo VARCHAR(150) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    solicitado_por INT NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_cambio),
    UNIQUE KEY uq_cambio_correo_token_hash (token_hash),
    KEY idx_cambio_correo_usuario (id_usuario, consumed_at),
    KEY idx_cambio_correo_expira (expires_at),
    CONSTRAINT fk_cambio_correo_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario),
    CONSTRAINT fk_cambio_correo_solicitante FOREIGN KEY (solicitado_por) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
