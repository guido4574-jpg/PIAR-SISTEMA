const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeColumnType, normalizeDefault, readAndValidateMigration, verifyRecoveryTable } = require("../scripts/apply-local-password-recovery-migration");

function compatibleTable({ createdAtExtra = "DEFAULT_GENERATED", createdAtDefault = "CURRENT_TIMESTAMP", nullable = "NO", type = "bigint(20)" } = {}) {
    const columns = [
        { COLUMN_NAME: "id_recuperacion", COLUMN_TYPE: type, IS_NULLABLE: "NO", COLUMN_DEFAULT: null, EXTRA: "auto_increment" },
        { COLUMN_NAME: "id_usuario", COLUMN_TYPE: "int(11)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, EXTRA: "" },
        { COLUMN_NAME: "token_hash", COLUMN_TYPE: "char(64)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, EXTRA: "" },
        { COLUMN_NAME: "expires_at", COLUMN_TYPE: "datetime", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, EXTRA: "" },
        { COLUMN_NAME: "consumed_at", COLUMN_TYPE: "datetime", IS_NULLABLE: "YES", COLUMN_DEFAULT: null, EXTRA: "" },
        { COLUMN_NAME: "created_at", COLUMN_TYPE: "datetime", IS_NULLABLE: nullable, COLUMN_DEFAULT: createdAtDefault, EXTRA: createdAtExtra }
    ];
    const indexes = [
        { INDEX_NAME: "PRIMARY", NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: "id_recuperacion" },
        { INDEX_NAME: "uq_token", NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: "token_hash" },
        { INDEX_NAME: "recovery_by_user", NON_UNIQUE: 1, SEQ_IN_INDEX: 1, COLUMN_NAME: "id_usuario" },
        { INDEX_NAME: "expiry_lookup", NON_UNIQUE: 1, SEQ_IN_INDEX: 1, COLUMN_NAME: "expires_at" }
    ];
    const foreignKeys = [{ CONSTRAINT_NAME: "recuperacion_contrasena_ibfk_1", COLUMN_NAME: "id_usuario", REFERENCED_TABLE_NAME: "usuario", REFERENCED_COLUMN_NAME: "id_usuario" }];
    return { columns, indexes, foreignKeys };
}

function metadataConnection(metadata) {
    return {
        async query(sql) {
            if (sql.includes("information_schema.TABLES")) return [[{ ENGINE: "InnoDB" }]];
            if (sql.includes("information_schema.COLUMNS")) return [metadata.columns];
            if (sql.includes("information_schema.STATISTICS")) return [metadata.indexes];
            if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [metadata.foreignKeys];
            assert.fail(`Unexpected schema query: ${sql}`);
        }
    };
}

test("schema validator accepts MySQL generated-default metadata and equivalent key names", async () => {
    const metadata = compatibleTable();
    await verifyRecoveryTable(metadataConnection(metadata));
    assert.equal(normalizeColumnType("BIGINT(20)"), "bigint");
    assert.equal(normalizeColumnType("INT(11) UNSIGNED"), "int unsigned");
    assert.equal(normalizeDefault("CURRENT_TIMESTAMP()"), "current_timestamp");
});

test("schema validator accepts MySQL versions that omit DEFAULT_GENERATED", async () => {
    await verifyRecoveryTable(metadataConnection(compatibleTable({ createdAtExtra: "" })));
});

test("schema validator reports genuine default, nullability and foreign-key mismatches", async () => {
    await assert.rejects(
        verifyRecoveryTable(metadataConnection(compatibleTable({ createdAtDefault: null }))),
        /created_at: default expected current_timestamp, found null/
    );
    await assert.rejects(
        verifyRecoveryTable(metadataConnection(compatibleTable({ nullable: "YES" }))),
        /created_at: nullable expected NO, found YES/
    );
    const wrongRelation = compatibleTable();
    wrongRelation.foreignKeys[0].REFERENCED_TABLE_NAME = "otra_tabla";
    await assert.rejects(verifyRecoveryTable(metadataConnection(wrongRelation)), /foreign key does not match usuario\.id_usuario/);
});

test("local migration matches the reviewed create-only SQL", () => {
    const sql = readAndValidateMigration();
    assert.match(sql, /^-- Local, additive migration/m);
    assert.doesNotMatch(sql, /\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE|USE)\b/i);
});

test("email-verification migration only adds its nullable timestamp and creates its token table", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/local/003_email_verification.sql"), "utf8");
    assert.match(sql, /ADD COLUMN correo_verificado_at DATETIME NULL/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS verificacion_correo/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/i);
});

test("approval audit migration is additive and records the deciding user", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/002_registration_decision_audit.sql"), "utf8");
    for (const column of ["aprobado_por_usuario_id", "rechazado_por_usuario_id", "decision_at"]) assert.match(sql, new RegExp(column));
    assert.match(sql, /FOREIGN KEY \(aprobado_por_usuario_id\) REFERENCES usuario \(id_usuario\)/i);
    assert.match(sql, /FOREIGN KEY \(rechazado_por_usuario_id\) REFERENCES usuario \(id_usuario\)/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/i);
});

test("registration decision reason migration only adds one nullable bounded column", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/010_registration_decision_reason.sql"), "utf8");
    assert.match(sql, /information_schema\.COLUMNS/i);
    assert.match(sql, /ADD COLUMN decision_reason VARCHAR\(500\) NULL/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/i);
});

test("initial administrator password-change migration is additive and repeatable", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/011_admin_initial_password_change.sql"), "utf8");
    assert.match(sql, /information_schema\.COLUMNS/i);
    assert.match(sql, /ADD COLUMN password_change_required TINYINT\(1\) NOT NULL DEFAULT 0/i);
    assert.match(sql, /'SELECT 1'/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE|USE)\b/i);
});

test("OIDC migration creates expiring one-time transactions and unique external identities additively", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/003_oidc_identity.sql"), "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS oidc_login_transaction/i);
    assert.match(sql, /state_hash CHAR\(64\).*PRIMARY KEY/s);
    assert.match(sql, /expires_at DATETIME NOT NULL/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS external_identity/i);
    assert.match(sql, /UNIQUE KEY uq_external_identity_issuer_subject \(issuer, subject\)/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE|USE)\b/i);
});

test("account-state migration widens only the known short VARCHAR state column", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/005_user_state_length.sql"), "utf8");
    assert.match(sql, /MAX\(DATA_TYPE\) = 'varchar'/i);
    assert.match(sql, /MAX\(CHARACTER_MAXIMUM_LENGTH\) < 30/i);
    assert.match(sql, /MODIFY COLUMN estado VARCHAR\(30\) NOT NULL DEFAULT ''activo''/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/i);
});

test("PIAR completion migration adds only optional pedagogical-cycle fields idempotently", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/006_piar_pedagogical_completion.sql"), "utf8");
    for (const column of ["actividades_receso", "otra_informacion", "acta_acuerdos", "informe_anual", "entrega_pedagogica"]) {
        assert.match(sql, new RegExp(`ADD COLUMN ${column} TEXT NULL`, "i"));
        assert.match(sql, new RegExp(`COLUMN_NAME = '${column}'`, "i"));
    }
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/i);
});

test("PIAR audit migration stores operation metadata without payload snapshots", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/007_piar_audit_events.sql"), "utf8");
    const ddl = sql.replace(/^\s*--.*$/gm, "");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS piar_auditoria/i);
    for (const field of ["actor_user_id", "action", "resource_type", "resource_id", "result", "http_status", "occurred_at"]) {
        assert.match(sql, new RegExp(`\\b${field}\\b`, "i"));
    }
    assert.doesNotMatch(ddl, /valor_anterior|valor_nuevo|password|token|descripcion\s+TEXT/i);
});

test("PIAR traceability migration is additive, preserves legacy text and uses same-plan relationships", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/008_piar_traceability.sql"), "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS piar_barrera/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS piar_ajuste_evidencia/i);
    for (const column of ["id_barrera", "id_usuario_responsable", "resultado_esperado", "indicador_logro", "fecha_revision_prevista"]) {
        assert.match(sql, new RegExp(`ADD COLUMN ${column}`, "i"));
    }
    assert.match(sql, /REFERENCES piar_barrera \(id_piar, id_barrera\)/i);
    assert.match(sql, /REFERENCES piar_ajuste \(id_piar, id_ajuste\)/i);
    assert.match(sql, /ADD COLUMN id_ajuste INT NULL/i);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/i);
});

test("administrative account audit migration is additive and stores no credential material", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/009_admin_account_audit.sql"), "utf8");
    const ddl = sql.replace(/^\s*--.*$/gm, "");
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS admin_account_audit/i);
    for (const field of ["target_user_id", "operation", "outcome", "operator_identity_claim", "operator_identity_source", "authorization_reference", "reason", "occurred_at"]) {
        assert.match(ddl, new RegExp(`\\b${field}\\b`, "i"));
    }
    assert.match(ddl, /FOREIGN KEY \(target_user_id\) REFERENCES usuario \(id_usuario\)/i);
    assert.doesNotMatch(ddl, /password|hash|token|secret|DROP|ALTER|DELETE|UPDATE|TRUNCATE/i);
});
