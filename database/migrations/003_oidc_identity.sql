-- OIDC login transactions and explicitly linked external identities.
-- Additive and repeatable; existing users and identities are not modified.

CREATE TABLE IF NOT EXISTS oidc_login_transaction (
    state_hash CHAR(64) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    nonce VARCHAR(100) NOT NULL,
    code_verifier VARCHAR(100) NOT NULL,
    link_user_id INT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (state_hash),
    KEY idx_oidc_transaction_expiry (expires_at),
    CONSTRAINT fk_oidc_transaction_user FOREIGN KEY (link_user_id) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS external_identity (
    id_external_identity BIGINT NOT NULL AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    issuer VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    email VARCHAR(254) NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_external_identity),
    UNIQUE KEY uq_external_identity_issuer_subject (issuer, subject),
    KEY idx_external_identity_user (id_usuario),
    CONSTRAINT fk_external_identity_user FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
