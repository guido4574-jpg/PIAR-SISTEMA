-- Local administrative account events. Operator identity is explicitly a claim
-- from a local CLI, not an authenticated application identity.
CREATE TABLE IF NOT EXISTS admin_account_audit (
    id_evento BIGINT NOT NULL AUTO_INCREMENT,
    target_user_id INT NULL,
    operation VARCHAR(32) NOT NULL,
    outcome VARCHAR(24) NOT NULL,
    operator_identity_claim VARCHAR(150) NULL,
    operator_identity_source VARCHAR(32) NOT NULL,
    authorization_reference VARCHAR(128) NULL,
    reason VARCHAR(500) NULL,
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_evento),
    KEY idx_admin_account_audit_target_time (target_user_id, occurred_at),
    KEY idx_admin_account_audit_operation_time (operation, occurred_at),
    CONSTRAINT fk_admin_account_audit_target
        FOREIGN KEY (target_user_id) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
