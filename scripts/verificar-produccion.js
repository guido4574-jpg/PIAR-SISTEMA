"use strict";

// Verificación de SOLO LECTURA de una base PIAR (producción o ensayo).
//   node scripts/verificar-produccion.js [--paquete <admin-row-178-....json>] [--esperar-admin]
// Conexión: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD y DB_SSL (off|required|verify).
// Comprueba: TLS, cuenta y privilegios, tablas esperadas, migraciones y checksums,
// cuentas Administrador y, con --paquete, la huella de la fila trasladada.
// Nunca escribe ni imprime correos, hashes ni contraseñas. Código de salida 1 si algo falla.
const fs = require("node:fs");
const { buildDatabaseConfig } = require("../backend/database-config");
const { migrationStatus } = require("../backend/migrations");
const { rowFingerprint, readBundle } = require("./admin-transfer");

const EXPECTED_TABLES = Object.freeze([
    "admin_account_audit", "cambio_correo", "coordinador", "diagnostico", "docente", "estudiante", "evento_seguridad",
    "external_identity", "historial", "historial_detalle", "limite_solicitudes", "observacion", "oidc_login_transaction",
    "piar", "piar_ajuste", "piar_ajuste_evidencia", "piar_auditoria", "piar_barrera", "piar_docente", "piar_dua",
    "psicologa", "recuperacion_contrasena", "reporte", "schema_migrations", "seguimiento", "sesion_usuario", "usuario",
    "verificacion_correo"
]);
const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"];

function parseArgs(argv) {
    const options = { expectAdmin: false, bundle: null };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === "--esperar-admin") options.expectAdmin = true;
        else if (argv[index] === "--paquete" && argv[index + 1]) { options.bundle = argv[index + 1]; index += 1; options.expectAdmin = true; }
        else throw new Error("Argumentos admitidos: --esperar-admin y --paquete <archivo>.");
    }
    return options;
}

// Clasifica los privilegios de SHOW GRANTS: "solo_dml", "ddl" o "global".
function classifyGrants(rows, database) {
    const scopes = { global: false, ddl: false, dml: new Set() };
    for (const row of rows) {
        const text = String(Object.values(row)[0] || "").replace(/`/g, "").replace(/\\_/g, "_");
        const match = text.match(/^GRANT (.+?) ON (.+?) TO /i);
        if (!match) continue;
        const privileges = match[1].split(",").map(item => item.trim().toUpperCase());
        const scope = match[2].trim();
        if (scope === "*.*") { if (!(privileges.length === 1 && privileges[0] === "USAGE")) scopes.global = true; continue; }
        if (scope.toLowerCase() !== `${database.toLowerCase()}.*`) { scopes.global = true; continue; }
        for (const privilege of privileges) {
            if (DML.includes(privilege)) scopes.dml.add(privilege); else scopes.ddl = true;
        }
    }
    if (scopes.global) return "global";
    if (scopes.ddl) return "ddl";
    return DML.every(privilege => scopes.dml.has(privilege)) ? "solo_dml" : "incompleta";
}

function evaluate(report) {
    const problems = [];
    if (report.tablasFaltantes.length) problems.push(`Faltan tablas: ${report.tablasFaltantes.join(", ")}.`);
    const notApplied = report.migraciones.filter(item => item.estado !== "aplicada");
    if (notApplied.length) problems.push(`Migraciones no aplicadas o modificadas: ${notApplied.map(item => `${item.version} (${item.estado})`).join(", ")}.`);
    if (report.privilegios !== "solo_dml") problems.push(`La cuenta conectada no es solo DML sobre el esquema (${report.privilegios}).`);
    if (report.administradores > 1) problems.push("Hay más de una cuenta Administrador.");
    if (report.esperarAdmin && report.administradores !== 1) problems.push("Se esperaba exactamente una cuenta Administrador.");
    if (report.huellaAdmin === false) problems.push("La fila de la Administradora no coincide con el paquete.");
    return problems;
}

async function inspect(connection, database, options) {
    const [[identity]] = await connection.query("SELECT VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account");
    const [ssl] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const [grants] = await connection.query("SHOW GRANTS");
    const [tables] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
    const tableNames = new Set(tables.map(row => row.name));
    const migrations = await migrationStatus(connection, undefined, { readOnly: true });
    let admins = 0;
    let users = 0;
    let fingerprint = null;
    if (tableNames.has("usuario")) {
        const [[counts]] = await connection.query("SELECT COUNT(*) AS users, SUM(rol = 'Administrador') AS admins FROM usuario");
        users = Number(counts.users);
        admins = Number(counts.admins || 0);
        if (options.bundle) {
            const bundle = readBundle(options.bundle);
            const columns = bundle.schema.columns.map(column => `\`${column.name.replace(/[^a-z0-9_]/gi, "")}\``).join(", ");
            const [rows] = await connection.query(`SELECT ${columns} FROM usuario WHERE id_usuario = ?`, [Number(bundle.row.id_usuario)]);
            fingerprint = Boolean(rows[0]) && rowFingerprint(rows[0]) === bundle.fingerprint;
        }
    }
    return {
        servidor: identity.version, base: identity.db, cuenta: String(identity.account).split("@")[0],
        tls: ssl[0]?.Value ? `sí (${ssl[0].Value})` : "no",
        privilegios: classifyGrants(grants, database),
        tablas: tableNames.size, tablasFaltantes: EXPECTED_TABLES.filter(name => !tableNames.has(name)),
        tablasAdicionales: [...tableNames].filter(name => !EXPECTED_TABLES.includes(name)),
        migraciones: migrations.map(item => ({ version: item.version, estado: item.state })),
        usuarios: users, administradores: admins, esperarAdmin: options.expectAdmin,
        huellaAdmin: fingerprint
    };
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const options = parseArgs(argv);
    if (options.bundle && !fs.existsSync(options.bundle)) throw new Error("No existe el paquete indicado.");
    const mysql = require("mysql2/promise");
    const config = { ...buildDatabaseConfig(env, { allowRoot: true }), dateStrings: true, timezone: "Z", connectTimeout: 10000 };
    const connection = await mysql.createConnection(config);
    try {
        await connection.query("SET SESSION TRANSACTION READ ONLY");
        const report = await inspect(connection, config.database, options);
        const problems = evaluate(report);
        const resumen = { ...report, migraciones: `${report.migraciones.filter(item => item.estado === "aplicada").length}/${report.migraciones.length} aplicadas` };
        console.log(JSON.stringify(resumen, null, 1));
        if (problems.length) {
            console.error(`VERIFICACIÓN NO SUPERADA:\n- ${problems.join("\n- ")}`);
            process.exitCode = 1;
        } else {
            console.log("VERIFICACIÓN SUPERADA.");
        }
        return { report, problems };
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`No se pudo verificar: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs, classifyGrants, evaluate, EXPECTED_TABLES };
