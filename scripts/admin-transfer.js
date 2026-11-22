"use strict";

// Traslado controlado de la cuenta Administradora principal (decisión D6).
// Copia SOLO la fila de `usuario` (mismo id, correo, hash, rol, estado y
// fechas). Excluye sesiones, tokens, transacciones OIDC, contadores, eventos
// y cualquier otra tabla. Nunca imprime la fila ni el hash de la contraseña:
// solo una huella SHA-256 de la fila completa para comparar origen y destino.
//
// Subcomandos (conexiones por variables SOURCE_DB_* y TARGET_DB_*):
//   export   --id N            origen -> archivo JSON fuera del repositorio
//   check    --file F          destino, solo lectura: compatibilidad y conflictos
//   import   --file F          destino, una transacción; exige PIAR_TRANSFER_CONFIRM=<TARGET_DB_NAME>
//   verify   --file F          destino, solo lectura: compara la huella
//   rollback --file F          destino; borra la fila solo si la huella coincide y nada la referencia
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.resolve(ROOT, "..", "PIAR-SISTEMA-respaldos", "transferencia-admin");
const SELF_REFERENCES = ["aprobado_por_usuario_id", "rechazado_por_usuario_id"];

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const options = {};
    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index];
        if (!/^--(id|file)$/.test(key) || rest[index + 1] === undefined) throw new Error("Argumentos admitidos: --id N o --file RUTA.");
        options[key.slice(2)] = rest[index + 1];
    }
    if (!["export", "check", "import", "verify", "rollback"].includes(command)) {
        throw new Error("Subcomando no válido: use export, check, import, verify o rollback.");
    }
    return { command, options };
}

function connectionConfig(prefix, env = process.env) {
    const read = name => String(env[`${prefix}_DB_${name}`] || "").trim();
    const missing = ["HOST", "PORT", "NAME", "USER", "PASSWORD"].filter(name => !read(name));
    if (missing.length) throw new Error(`Faltan variables ${missing.map(name => `${prefix}_DB_${name}`).join(", ")}.`);
    const port = Number(read("PORT"));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${prefix}_DB_PORT no es un puerto válido.`);
    const ssl = read("SSL").toLowerCase();
    return {
        host: read("HOST"), port, database: read("NAME"), user: read("USER"), password: env[`${prefix}_DB_PASSWORD`],
        // Fechas como texto y sesión en UTC: los valores se copian sin conversiones.
        dateStrings: true, timezone: "Z", connectTimeout: 10000,
        ...(ssl === "required" ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: false } } : {})
    };
}

function normalizeValue(value) {
    if (value === null || value === undefined) return null;
    if (Buffer.isBuffer(value)) return `hex:${value.toString("hex")}`;
    return String(value);
}

// Huella de la fila: columnas en orden alfabético y valores normalizados.
function rowFingerprint(row) {
    const ordered = Object.keys(row).sort().map(key => [key, normalizeValue(row[key])]);
    return crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

async function usuarioColumns(connection) {
    const [rows] = await connection.query(
        "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' ORDER BY ORDINAL_POSITION"
    );
    return rows.map(row => ({ name: row.name, type: String(row.type).toLowerCase(), nullable: row.nullable }));
}

async function appliedMigrations(connection) {
    const [exists] = await connection.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
    if (!exists.length) return [];
    const [rows] = await connection.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
    return rows.map(row => ({ version: row.version, checksum: row.checksum }));
}

function quoteIdentifier(name) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error("Nombre de columna no válido.");
    return `\`${name}\``;
}

// Comparación pura entre el paquete exportado y el estado del destino.
function compatibilityProblems(bundle, target) {
    const problems = [];
    const targetMigrations = new Map(target.migrations.map(item => [item.version, item.checksum]));
    for (const migration of bundle.schema.migrations) {
        if (!targetMigrations.has(migration.version)) problems.push(`El destino no tiene la migración ${migration.version}.`);
        else if (targetMigrations.get(migration.version) !== migration.checksum) problems.push(`La migración ${migration.version} tiene otro checksum en el destino.`);
    }
    // El orden físico de las columnas varía entre una base migrada por etapas y una
    // nueva; la inserción usa nombres explícitos, así que se compara sin orden.
    const canonical = columns => JSON.stringify([...columns].map(({ name, type, nullable }) => ({ name, type, nullable }))
        .sort((left, right) => left.name.localeCompare(right.name)));
    if (canonical(target.columns) !== canonical(bundle.schema.columns)) problems.push("Las columnas de usuario (nombre, tipo o nulabilidad) no coinciden con el origen.");
    if (target.conflicts.sameId) problems.push("El destino ya tiene un usuario con ese id.");
    if (target.conflicts.sameEmail) problems.push("El destino ya tiene un usuario con ese correo.");
    if (target.conflicts.sameDocument) problems.push("El destino ya tiene un usuario con ese documento.");
    if (target.conflicts.administrators > 0) problems.push("El destino ya tiene una cuenta Administrador; no se crea otra.");
    return problems;
}

async function inspectTarget(connection, bundle) {
    const row = bundle.row;
    const [[conflicts]] = await connection.query(
        "SELECT SUM(id_usuario = ?) AS sameId, SUM(correo = ?) AS sameEmail, SUM(documento = ?) AS sameDocument, SUM(rol = 'Administrador') AS administrators FROM usuario",
        [Number(row.id_usuario), row.correo, row.documento]
    );
    return {
        migrations: await appliedMigrations(connection),
        columns: await usuarioColumns(connection),
        conflicts: Object.fromEntries(Object.entries(conflicts).map(([key, value]) => [key, Number(value || 0)]))
    };
}

async function readTargetRow(connection, bundle) {
    const columns = bundle.schema.columns.map(column => quoteIdentifier(column.name)).join(", ");
    const [rows] = await connection.query(`SELECT ${columns} FROM usuario WHERE id_usuario = ?`, [Number(bundle.row.id_usuario)]);
    return rows[0] || null;
}

function resolveOutputDir(env = process.env) {
    const dir = path.resolve(env.PIAR_TRANSFER_DIR || DEFAULT_OUTPUT_DIR);
    const relative = path.relative(ROOT, dir);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("El paquete no puede guardarse dentro del repositorio.");
    return dir;
}

function readBundle(file) {
    const content = fs.readFileSync(file, "utf8");
    const bundle = JSON.parse(content);
    if (bundle.format !== "piar-admin-transfer/1" || !bundle.row || rowFingerprint(bundle.row) !== bundle.fingerprint) {
        throw new Error("El paquete no es válido o su huella no coincide con la fila.");
    }
    return bundle;
}

async function exportAccount(connection, id, env = process.env) {
    if (!Number.isInteger(id) || id < 1) throw new Error("--id debe ser un entero positivo.");
    const columns = await usuarioColumns(connection);
    const [rows] = await connection.query(`SELECT ${columns.map(column => quoteIdentifier(column.name)).join(", ")} FROM usuario WHERE id_usuario = ?`, [id]);
    const row = rows[0];
    if (!row) throw new Error("La cuenta no existe en el origen.");
    if (row.rol !== "Administrador" || row.estado !== "activo") throw new Error("La cuenta de origen no es un Administrador activo.");
    if (SELF_REFERENCES.some(column => row[column] !== null && row[column] !== undefined)) {
        throw new Error("La cuenta referencia a otro usuario (aprobación o rechazo); no se puede trasladar sola sin alterarla.");
    }
    const bundle = {
        format: "piar-admin-transfer/1",
        exportedAt: new Date().toISOString(),
        source: { host: connection.piarTarget?.host, port: connection.piarTarget?.port, database: connection.piarTarget?.database },
        schema: { migrations: await appliedMigrations(connection), columns },
        row,
        fingerprint: rowFingerprint(row)
    };
    const dir = resolveOutputDir(env);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = bundle.exportedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const file = path.join(dir, `admin-row-${id}-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(bundle, null, 2), { mode: 0o600, flag: "wx" });
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    fs.writeFileSync(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`, { flag: "wx" });
    return { file, fingerprint: bundle.fingerprint, columns: columns.length };
}

async function importAccount(connection, bundle, env = process.env) {
    if (String(env.PIAR_TRANSFER_CONFIRM || "") !== connection.piarTarget?.database) {
        throw new Error("Confirme el destino con PIAR_TRANSFER_CONFIRM igual a TARGET_DB_NAME.");
    }
    await connection.beginTransaction();
    try {
        const problems = compatibilityProblems(bundle, await inspectTarget(connection, bundle));
        if (problems.length) throw new Error(`No se importó: ${problems.join(" ")}`);
        const names = bundle.schema.columns.map(column => column.name);
        await connection.query(
            `INSERT INTO usuario (${names.map(quoteIdentifier).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
            names.map(name => bundle.row[name])
        );
        const saved = await readTargetRow(connection, bundle);
        if (!saved || rowFingerprint(saved) !== bundle.fingerprint) throw new Error("La huella de la fila insertada no coincide; se revirtió.");
        await connection.commit();
        return { fingerprint: bundle.fingerprint };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function referencingRows(connection, id) {
    const [references] = await connection.query(
        "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'usuario' AND REFERENCED_COLUMN_NAME = 'id_usuario'"
    );
    let total = 0;
    for (const { tableName, columnName } of references) {
        const [[{ count }]] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} = ?`, [id]);
        total += Number(count);
    }
    return total;
}

async function rollbackAccount(connection, bundle, env = process.env) {
    if (String(env.PIAR_TRANSFER_CONFIRM || "") !== connection.piarTarget?.database) {
        throw new Error("Confirme el destino con PIAR_TRANSFER_CONFIRM igual a TARGET_DB_NAME.");
    }
    const id = Number(bundle.row.id_usuario);
    await connection.beginTransaction();
    try {
        const current = await readTargetRow(connection, bundle);
        if (!current) throw new Error("La cuenta no existe en el destino.");
        if (rowFingerprint(current) !== bundle.fingerprint) throw new Error("La fila cambió desde la importación; no se borra.");
        const references = await referencingRows(connection, id);
        if (references) throw new Error(`La cuenta ya tiene ${references} registros asociados (sesiones, auditoría u otros); no se borra.`);
        const [result] = await connection.query("DELETE FROM usuario WHERE id_usuario = ? LIMIT 1", [id]);
        if (Number(result.affectedRows) !== 1) throw new Error("No se pudo borrar exactamente una fila.");
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const mysql = require("mysql2/promise");
    const { command, options } = parseArgs(argv);
    const prefix = command === "export" ? "SOURCE" : "TARGET";
    const config = connectionConfig(prefix, env);
    const connection = await mysql.createConnection(config);
    connection.piarTarget = { host: config.host, port: config.port, database: config.database };
    try {
        await connection.query("SET SESSION time_zone = '+00:00'");
        const target = `${config.host}:${config.port}/${config.database}`;
        if (command === "export") {
            const result = await exportAccount(connection, Number(options.id), env);
            console.log(`Paquete creado: ${result.file}\nColumnas: ${result.columns}\nHuella de la fila: ${result.fingerprint}`);
            return;
        }
        if (!options.file) throw new Error("Indique --file con el paquete exportado.");
        const bundle = readBundle(options.file);
        if (command === "check") {
            const problems = compatibilityProblems(bundle, await inspectTarget(connection, bundle));
            if (problems.length) {
                console.error(`Destino ${target} NO compatible:\n- ${problems.join("\n- ")}`);
                process.exitCode = 1;
            } else console.log(`Destino ${target} compatible: migraciones, columnas y ausencia de conflictos verificadas.`);
            return;
        }
        if (command === "import") {
            const result = await importAccount(connection, bundle, env);
            console.log(`Cuenta importada en ${target}. Huella verificada: ${result.fingerprint}`);
            return;
        }
        if (command === "verify") {
            const current = await readTargetRow(connection, bundle);
            const same = Boolean(current) && rowFingerprint(current) === bundle.fingerprint;
            console.log(same ? `Huella idéntica en ${target}: ${bundle.fingerprint}` : `La fila NO coincide o no existe en ${target}.`);
            if (!same) process.exitCode = 1;
            return;
        }
        await rollbackAccount(connection, bundle, env);
        console.log(`Importación revertida en ${target}: se borró solo la fila trasladada.`);
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Traslado no realizado: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, connectionConfig, rowFingerprint, compatibilityProblems, resolveOutputDir, readBundle, exportAccount, importAccount, rollbackAccount };
