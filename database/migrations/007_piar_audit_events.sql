-- Metadata-only audit trail for access to student and PIAR resources.
-- No request bodies, health details, tokens, passwords, or secrets are stored.
CREATE TABLE IF NOT EXISTS piar_auditoria (
    id_evento BIGINT NOT NULL AUTO_INCREMENT,
    actor_user_id INT NULL,
    action VARCHAR(12) NOT NULL,
    resource_type VARCHAR(40) NOT NULL,
    resource_id BIGINT NULL,
    result VARCHAR(12) NOT NULL,
    http_status SMALLINT NOT NULL,
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_evento),
    KEY idx_piar_auditoria_actor_time (actor_user_id, occurred_at),
    KEY idx_piar_auditoria_resource_time (resource_type, resource_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
