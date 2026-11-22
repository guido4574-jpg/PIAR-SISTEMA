-- Local-only migration for traditional registration and email verification.
-- MySQL 8.0. Apply only while DATABASE() is exactly piar_test.
-- The helper procedure is created in piar_test, validates first, then performs DDL.
-- It inserts, updates, deletes, or copies no application rows.

-- Remove only a leftover helper from an earlier interrupted run of this migration.
DROP PROCEDURE IF EXISTS piar_test._piar_004_auth_schema_guard;

DELIMITER $$
CREATE PROCEDURE piar_test._piar_004_auth_schema_guard()
SQL SECURITY INVOKER
BEGIN
    DECLARE v_count BIGINT DEFAULT 0;
    DECLARE v_bad BIGINT DEFAULT 0;
    DECLARE v_engine VARCHAR(64) DEFAULT NULL;
    DECLARE v_type VARCHAR(64) DEFAULT NULL;
    DECLARE v_column_type VARCHAR(255) DEFAULT NULL;
    DECLARE v_state_length BIGINT DEFAULT NULL;
    DECLARE v_state_extra VARCHAR(255) DEFAULT NULL;
    DECLARE v_nullable VARCHAR(3) DEFAULT NULL;
    DECLARE v_extra VARCHAR(255) DEFAULT NULL;
    DECLARE v_key VARCHAR(64) DEFAULT NULL;
    DECLARE v_default TEXT DEFAULT NULL;
    DECLARE v_charset VARCHAR(64) DEFAULT NULL;
    DECLARE v_collation VARCHAR(64) DEFAULT NULL;
    DECLARE v_comment TEXT DEFAULT NULL;
    DECLARE v_sql LONGTEXT DEFAULT NULL;
    DECLARE v_verification_exists BOOLEAN DEFAULT FALSE;
    DECLARE v_verification_object_type VARCHAR(64) DEFAULT NULL;

    IF DATABASE() IS NULL OR DATABASE() <> 'piar_test' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: DATABASE() debe ser exactamente piar_test.';
    END IF;

    SELECT COUNT(*), MAX(ENGINE)
      INTO v_count, v_engine
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'piar_test'
       AND TABLE_NAME = 'usuario'
       AND TABLE_TYPE = 'BASE TABLE';
    IF v_count <> 1 OR v_engine <> 'InnoDB' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: piar_test.usuario debe existir como tabla InnoDB.';
    END IF;

    SELECT COUNT(*), MAX(DATA_TYPE), MAX(COLUMN_TYPE), MAX(IS_NULLABLE), MAX(EXTRA), MAX(COLUMN_KEY)
      INTO v_count, v_type, v_column_type, v_nullable, v_extra, v_key
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'piar_test'
       AND TABLE_NAME = 'usuario'
       AND COLUMN_NAME = 'id_usuario';
    IF v_count <> 1 OR v_type <> 'int' OR v_column_type LIKE '%unsigned%'
       OR v_nullable <> 'NO' OR v_extra NOT LIKE '%auto_increment%'
       OR v_key <> 'PRI' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: usuario.id_usuario debe ser INT firmado, NOT NULL, AUTO_INCREMENT y clave primaria.';
    END IF;
    SELECT COUNT(*) INTO v_count
      FROM (
          SELECT INDEX_NAME
            FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = 'piar_test'
             AND TABLE_NAME = 'usuario'
             AND INDEX_NAME = 'PRIMARY'
           GROUP BY INDEX_NAME
          HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'id_usuario'
      ) AS valid_user_primary_key;
    IF v_count <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: usuario.id_usuario debe ser la unica columna de la clave primaria.';
    END IF;

    SELECT COUNT(*), MAX(DATA_TYPE), MAX(CHARACTER_MAXIMUM_LENGTH), MAX(EXTRA)
      INTO v_count, v_type, v_state_length, v_state_extra
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'piar_test'
       AND TABLE_NAME = 'usuario'
       AND COLUMN_NAME = 'estado';
    IF v_count <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: falta piar_test.usuario.estado.';
    END IF;
    IF v_type <> 'varchar' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: usuario.estado debe ser VARCHAR; no se convirtió automáticamente.';
    END IF;
    IF COALESCE(v_state_extra, '') <> '' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: usuario.estado tiene atributo EXTRA no compatible con una columna de estado ordinaria.';
    END IF;

    -- Refuse CHECK constraints on usuario for manual review. MySQL 8.0.16+
    -- enforces CHECK constraints; earlier 8.0 releases ignore them.
    SELECT COUNT(*)
      INTO v_count
      FROM information_schema.TABLE_CONSTRAINTS tc
     WHERE tc.CONSTRAINT_SCHEMA = 'piar_test'
       AND tc.TABLE_NAME = 'usuario'
       AND tc.CONSTRAINT_TYPE = 'CHECK';
    IF v_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: usuario.estado participa en una restriccion CHECK que requiere revision manual.';
    END IF;

    -- Validate an existing verification timestamp instead of silently accepting
    -- a same-named column with an incompatible definition.
    SELECT COUNT(*), MAX(DATA_TYPE), MAX(IS_NULLABLE), MAX(EXTRA)
      INTO v_count, v_type, v_nullable, v_extra
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'piar_test'
       AND TABLE_NAME = 'usuario'
       AND COLUMN_NAME = 'correo_verificado_at';
    IF v_count > 0 AND (v_type <> 'datetime' OR v_nullable <> 'YES' OR COALESCE(v_extra, '') <> '') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion 004 abortada: usuario.correo_verificado_at existe pero no es DATETIME NULL.';
    END IF;

    -- If the token table already exists, validate its engine, character set,
    -- required column definitions, keys and FK before making any schema change.
    SELECT COUNT(*), MAX(TABLE_TYPE), MAX(ENGINE), MAX(TABLE_COLLATION)
      INTO v_count, v_verification_object_type, v_engine, v_collation
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'piar_test'
       AND TABLE_NAME = 'verificacion_correo';
    IF v_count > 0 THEN
        IF v_verification_object_type <> 'BASE TABLE' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: verificacion_correo ya existe pero no es una tabla base.';
        END IF;
        SET v_verification_exists = TRUE;
        IF v_engine <> 'InnoDB' OR LEFT(v_collation, 7) <> 'utf8mb4' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: verificacion_correo debe usar InnoDB y charset utf8mb4.';
        END IF;

        SELECT COUNT(DISTINCT COLUMN_NAME), SUM(
            (COLUMN_NAME = 'id_verificacion' AND (DATA_TYPE <> 'bigint' OR COLUMN_TYPE LIKE '%unsigned%' OR IS_NULLABLE <> 'NO' OR EXTRA NOT LIKE '%auto_increment%')) OR
            (COLUMN_NAME = 'id_usuario' AND (DATA_TYPE <> 'int' OR COLUMN_TYPE LIKE '%unsigned%' OR IS_NULLABLE <> 'NO')) OR
            (COLUMN_NAME = 'token_hash' AND (DATA_TYPE <> 'char' OR CHARACTER_MAXIMUM_LENGTH <> 64 OR IS_NULLABLE <> 'NO')) OR
            (COLUMN_NAME = 'expires_at' AND (DATA_TYPE <> 'datetime' OR IS_NULLABLE <> 'NO')) OR
            (COLUMN_NAME = 'consumed_at' AND (DATA_TYPE <> 'datetime' OR IS_NULLABLE <> 'YES')) OR
            (COLUMN_NAME = 'created_at' AND (DATA_TYPE <> 'datetime' OR IS_NULLABLE <> 'NO' OR COALESCE(LOWER(REPLACE(COLUMN_DEFAULT, '()', '')), '') <> 'current_timestamp'))
        )
          INTO v_count, v_bad
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = 'piar_test'
           AND TABLE_NAME = 'verificacion_correo'
           AND COLUMN_NAME IN ('id_verificacion', 'id_usuario', 'token_hash', 'expires_at', 'consumed_at', 'created_at');
        IF v_count <> 6 OR v_bad <> 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: columnas o tipos existentes de verificacion_correo no coinciden con el esquema requerido.';
        END IF;

        SELECT COUNT(*) INTO v_count
          FROM (
              SELECT INDEX_NAME
                FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = 'piar_test'
                 AND TABLE_NAME = 'verificacion_correo'
                 AND INDEX_NAME = 'PRIMARY'
               GROUP BY INDEX_NAME
              HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'id_verificacion'
          ) AS valid_primary_key;
        IF v_count <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: verificacion_correo requiere PRIMARY KEY(id_verificacion).';
        END IF;

        SELECT COUNT(*) INTO v_count
          FROM (
              SELECT INDEX_NAME
                FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = 'piar_test'
                 AND TABLE_NAME = 'verificacion_correo'
                 AND NON_UNIQUE = 0
               GROUP BY INDEX_NAME
              HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'token_hash'
          ) AS valid_token_unique_index;
        IF v_count <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: verificacion_correo.token_hash requiere indice UNIQUE de una sola columna.';
        END IF;

        SELECT COUNT(DISTINCT COLUMN_NAME) INTO v_count
          FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = 'piar_test'
           AND TABLE_NAME = 'verificacion_correo'
           AND SEQ_IN_INDEX = 1
           AND COLUMN_NAME IN ('id_usuario', 'expires_at');
        IF v_count <> 2 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: verificacion_correo requiere indices que comiencen por id_usuario y expires_at.';
        END IF;

        SELECT COUNT(*) INTO v_count
          FROM information_schema.KEY_COLUMN_USAGE
         WHERE CONSTRAINT_SCHEMA = 'piar_test'
           AND TABLE_NAME = 'verificacion_correo'
           AND CONSTRAINT_NAME = 'fk_verificacion_correo_usuario'
           AND COLUMN_NAME = 'id_usuario'
           AND REFERENCED_TABLE_NAME = 'usuario'
           AND REFERENCED_COLUMN_NAME = 'id_usuario';
        IF v_count <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: FK fk_verificacion_correo_usuario incompatible o ausente.';
        END IF;
    END IF;

    IF NOT v_verification_exists THEN
        SELECT COUNT(*) INTO v_count
          FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = 'piar_test'
           AND CONSTRAINT_NAME = 'fk_verificacion_correo_usuario';
        IF v_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migracion 004 abortada: el nombre de FK fk_verificacion_correo_usuario ya esta en uso en piar_test.';
        END IF;
    END IF;

    -- Widen only the known VARCHAR column. Keep its current nullability, default,
    -- charset, collation and comment; reject lengths/type problems above.
    IF v_state_length < 30 THEN
        SELECT IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_COMMENT
          INTO v_nullable, v_default, v_charset, v_collation, v_comment
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = 'piar_test'
           AND TABLE_NAME = 'usuario'
           AND COLUMN_NAME = 'estado';
        SET v_sql = CONCAT(
            'ALTER TABLE piar_test.usuario MODIFY COLUMN estado VARCHAR(30)',
            IF(v_charset IS NULL, '', CONCAT(' CHARACTER SET ', v_charset)),
            IF(v_collation IS NULL, '', CONCAT(' COLLATE ', v_collation)),
            IF(v_nullable = 'NO', ' NOT NULL', ' NULL'),
            IF(v_default IS NULL, '', CONCAT(' DEFAULT ', QUOTE(v_default))),
            IF(v_comment = '', '', CONCAT(' COMMENT ', QUOTE(v_comment)))
        );
        SET @piar_004_sql = v_sql;
        PREPARE piar_004_stmt FROM @piar_004_sql;
        EXECUTE piar_004_stmt;
        DEALLOCATE PREPARE piar_004_stmt;
    END IF;

    IF NOT v_verification_exists THEN
        SELECT COUNT(*) INTO v_count
          FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = 'piar_test'
           AND TABLE_NAME = 'verificacion_correo';
        IF v_count = 0 THEN
            SET @piar_004_sql = 'CREATE TABLE piar_test.verificacion_correo (
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
                CONSTRAINT fk_verificacion_correo_usuario
                    FOREIGN KEY (id_usuario) REFERENCES piar_test.usuario (id_usuario)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
            PREPARE piar_004_stmt FROM @piar_004_sql;
            EXECUTE piar_004_stmt;
            DEALLOCATE PREPARE piar_004_stmt;
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_count
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'piar_test'
       AND TABLE_NAME = 'usuario'
       AND COLUMN_NAME = 'correo_verificado_at';
    IF v_count = 0 THEN
        SET @piar_004_sql = 'ALTER TABLE piar_test.usuario ADD COLUMN correo_verificado_at DATETIME NULL';
        PREPARE piar_004_stmt FROM @piar_004_sql;
        EXECUTE piar_004_stmt;
        DEALLOCATE PREPARE piar_004_stmt;
    END IF;
END$$
DELIMITER ;

CALL piar_test._piar_004_auth_schema_guard();
DROP PROCEDURE piar_test._piar_004_auth_schema_guard;
