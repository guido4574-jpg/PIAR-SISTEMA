-- Additive and re-runnable.
-- Diseño Universal para el Aprendizaje (DUA) strategies associated with a PIAR,
-- organised by the three DUA principles: multiple means of representation,
-- action and expression, and engagement.
CREATE TABLE IF NOT EXISTS piar_dua (
    id_dua INT NOT NULL AUTO_INCREMENT,
    id_piar INT NOT NULL,
    principio ENUM('representacion', 'accion_expresion', 'implicacion') NOT NULL,
    area VARCHAR(100) NULL,
    estrategia TEXT NOT NULL,
    recursos TEXT NULL,
    id_usuario_registro INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_dua),
    KEY idx_piar_dua_piar (id_piar, principio),
    KEY idx_piar_dua_usuario (id_usuario_registro),
    CONSTRAINT fk_piar_dua_piar FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_piar_dua_usuario FOREIGN KEY (id_usuario_registro) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
