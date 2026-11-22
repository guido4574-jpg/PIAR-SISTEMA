"use strict";

const mysql = require("mysql2/promise");
// Load config with its test guard active, then restore the caller's environment.
// This CLI never reads .env or .env.test.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
require("../backend/config");
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;
const crypto = require("node:crypto");
const { assertDemoSeedPrivileges } = require("./create-local-demo-accounts");
const { mysqlConnectionConfig } = require("./local-piar-test-config");
const { assertPersistentEmailTransport, verifySmtpTransport, describeSmtpDiagnostic } = require("../backend/email");
const { createInitialAdmin, ADMIN_OPERATION_LOCK, OPERATOR_FIELDS, textFieldProblem, operatorFieldProblem } = require("../backend/admin-account-operations");
const auth = require("../backend/auth");

// Single local MySQL: container piar-mysql-test published on 127.0.0.1:3307
// (MySQL listens on 3306 inside the container, which is what @@port reports).
// The native backend (scripts/start-local-backend.js) serves http://127.0.0.1:8090.
const TARGET = Object.freeze({ host: "127.0.0.1", port: 3307, serverPort: 3306, database: "piar_test", user: "piar_test" });
const LOCAL_APP_URL = "http://127.0.0.1:8090";
// El correo de la Administradora principal no se versiona (dato personal): se indica en la
// sesión con PIAR_BOOTSTRAP_ADMIN_EMAIL. Este bootstrap no debe volver a ejecutarse (decisión D6).
const TARGET_ADMIN_EMAIL = String(process.env.PIAR_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const TARGET_CONFIRMATION = "CONSULTAR ADMINISTRADOR EN piar_test EN PUERTO 3307";
const CREATE_CONFIRMATION = "APROVISIONAR ADMINISTRADOR LOCAL EN piar_test EN PUERTO 3307";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_ATTEMPTS = 3;
// Datos del aprovisionamiento en el orden en que se piden. Los límites de nombre y
// documento son los de createInitialAdmin; los del operador, los de OPERATOR_FIELDS.
const PROVISIONING_FIELDS = Object.freeze([
    Object.freeze({ key: "name", prompt: "Nombre visible de la persona autorizada: ", validate: value => textFieldProblem("Nombre visible", value, 150) }),
    Object.freeze({ key: "document", prompt: "Documento de la persona autorizada: ", validate: value => textFieldProblem("Documento", value, 30) }),
    Object.freeze({ key: "operatorIdentityClaim", prompt: "Identidad declarada del operador local: ", validate: value => operatorFieldProblem("operatorIdentityClaim", value) }),
    Object.freeze({ key: "authorizationReference", prompt: "Referencia de autorización institucional: ", validate: value => operatorFieldProblem("authorizationReference", value) }),
    Object.freeze({ key: "reason", prompt: "Motivo de aprovisionamiento: ", validate: value => operatorFieldProblem("reason", value) })
]);

function generateTemporaryPassword() {
    return crypto.randomBytes(24).toString("base64url");
}

function validateTargetEnvironment(env = process.env) {
    const expected = { DB_HOST: TARGET.host, DB_PORT: String(TARGET.port), DB_NAME: TARGET.database, DB_USER: TARGET.user };
    for (const [key, value] of Object.entries(expected)) {
        const configured = String(env[key] || "").trim();
        if (configured && configured.toLowerCase() !== value.toLowerCase()) {
            if (key === "DB_NAME" && configured.toLowerCase() === "piar") {
                throw new Error("DB_NAME apunta a la base institucional 'piar'; el aprovisionamiento se cancela.");
            }
            throw new Error(`La configuración ${key} no coincide con el destino local piar_test; el aprovisionamiento se cancela.`);
        }
    }
    return true;
}

function readLine(prompt) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Ejecuta este script desde una terminal interactiva.");
    return new Promise(resolve => {
        const readline = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
        readline.question(prompt, answer => { readline.close(); resolve(answer.trim()); });
    });
}

// stats (opcional) recibe cuántos caracteres de control se descartaron, por
// ejemplo un Ctrl+V que la consola entrega como carácter en lugar de pegar texto.
function readHidden(prompt, stats = null) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("Ejecuta este script desde una terminal interactiva.");
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        let value = "";
        if (stats) stats.ignoredControls = 0;
        process.stdout.write(prompt);
        stdin.setRawMode(true);
        stdin.resume();
        const cleanup = () => { stdin.removeListener("data", onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write("\n"); };
        const onData = chunk => {
            for (const char of chunk.toString("utf8")) {
                if (char === "\u0003") { cleanup(); reject(new Error("Ejecución cancelada.")); return; }
                if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
                if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
                else if (char >= " ") value += char;
                else if (stats) stats.ignoredControls += 1;
            }
        };
        stdin.on("data", onData);
    });
}

async function assertTargetAndSchema(connection) {
    const server = await assertBootstrapTarget(connection);
    const [grantRows] = await connection.query("SHOW GRANTS");
    assertDemoSeedPrivileges(grantRows);
    const [columns] = await connection.execute(
        "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuario' AND COLUMN_NAME IN ('nombre','documento','correo','rol','contrasena','password_hash','estado','correo_verificado_at','password_change_required')",
        [TARGET.database]
    );
    const byName = new Map(columns.map(column => [column.COLUMN_NAME, column]));
    const required = ["nombre", "documento", "correo", "rol", "contrasena", "password_hash", "estado", "correo_verificado_at", "password_change_required"];
    if (required.some(name => !byName.has(name))) throw new Error("Faltan columnas de usuario requeridas; no se creó ninguna cuenta.");
    if (byName.get("correo").DATA_TYPE.toLowerCase() !== "varchar" || byName.get("correo_verificado_at").DATA_TYPE.toLowerCase() !== "datetime") {
        throw new Error("Las columnas de correo no tienen el tipo esperado; no se creó ninguna cuenta.");
    }
    if (byName.get("estado").DATA_TYPE.toLowerCase() !== "varchar" || Number(byName.get("estado").CHARACTER_MAXIMUM_LENGTH) < 22) {
        throw new Error("usuario.estado no admite pendiente_verificacion; no se creó ninguna cuenta.");
    }
    if (byName.get("password_change_required").DATA_TYPE.toLowerCase() !== "tinyint" || byName.get("password_change_required").IS_NULLABLE !== "NO") {
        throw new Error("password_change_required no tiene el tipo seguro esperado; no se creó ninguna cuenta.");
    }
    if (byName.get("correo_verificado_at").IS_NULLABLE !== "YES" || !byName.get("rol").COLUMN_TYPE.includes("Administrador")) {
        throw new Error("El esquema no permite el bootstrap revisado; no se creó ninguna cuenta.");
    }
    await assertAdminProvisioningSchema(connection);
    return server;
}

async function assertAdminProvisioningSchema(connection) {
    const [rows] = await connection.execute(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('verificacion_correo','admin_account_audit')",
        [TARGET.database]
    );
    const columns = new Map();
    for (const row of rows) {
        if (!columns.has(row.TABLE_NAME)) columns.set(row.TABLE_NAME, new Set());
        columns.get(row.TABLE_NAME).add(row.COLUMN_NAME);
    }
    const required = {
        verificacion_correo: ["id_usuario", "token_hash", "expires_at", "consumed_at"],
        admin_account_audit: ["target_user_id", "operation", "outcome", "operator_identity_claim", "operator_identity_source", "authorization_reference", "reason", "occurred_at"]
    };
    for (const [table, fields] of Object.entries(required)) {
        if (fields.some(field => !columns.get(table)?.has(field))) {
            throw new Error(`Falta el esquema ${table}; no se modificó ninguna cuenta. Aplica la migración local aprobada a piar_test.`);
        }
    }
}

async function assertBootstrapTarget(connection) {
    const [[server]] = await connection.query("SELECT DATABASE() AS database_name, @@port AS server_port, @@read_only AS read_only, CURRENT_USER() AS account_name");
    if (server.database_name !== TARGET.database || Number(server.server_port) !== TARGET.serverPort || Number(server.read_only) !== 0 || !String(server.account_name).toLowerCase().startsWith("piar_test@")) {
        throw new Error("El servidor conectado no corresponde a la instancia local aislada piar_test.");
    }
    return server;
}

async function lookupByEmail(connection, email) {
    const [rows] = await connection.execute(
        "SELECT rol, estado, correo_verificado_at FROM usuario WHERE LOWER(correo) = LOWER(?) LIMIT 2",
        [email]
    );
    if (rows.length > 1) throw new Error("El correo devuelve más de una cuenta; no se modificó ninguna.");
    return rows[0] || null;
}

async function createPrimaryAdmin(connection, input) {
    return createInitialAdmin(connection, input);
}

// Describe la contraseña de aplicación recibida sin revelarla: solo longitud,
// si cumple el formato de Google (16 letras minúsculas) y controles descartados.
function describeAppPasswordInput(value, ignoredControls = 0) {
    const text = String(value || "");
    const expectedFormat = /^[a-z]{16}$/.test(text);
    const lines = [`Contraseña de aplicación recibida: ${[...text].length} caracteres; formato de Google (16 letras minúsculas): ${expectedFormat ? "sí" : "no"}; caracteres de control descartados: ${ignoredControls}.`];
    if (ignoredControls > 0) lines.push("La consola entregó caracteres de control (por ejemplo Ctrl+V): pega con clic derecho o escribe la contraseña a mano.");
    if (!expectedFormat) lines.push("Google genera 16 letras minúsculas; los espacios se eliminan automáticamente.");
    return { expectedFormat, text: lines.join("\n") };
}

// Pide un dato y lo valida en el momento. Una respuesta vacía por un salto de línea
// suelto o por un Ctrl+V que la consola no pegó se vuelve a preguntar, hasta
// MAX_FIELD_ATTEMPTS veces. Los avisos nunca repiten el valor escrito.
async function promptValidatedField(field, { read = readLine, write = text => process.stderr.write(text) } = {}) {
    for (let attempt = 1; attempt <= MAX_FIELD_ATTEMPTS; attempt += 1) {
        const value = String(await read(field.prompt) ?? "").trim();
        const problem = field.validate(value);
        if (!problem) return value;
        write(`${problem} Intento ${attempt} de ${MAX_FIELD_ATTEMPTS}.${attempt < MAX_FIELD_ATTEMPTS ? " Escríbelo de nuevo." : ""}\n`);
    }
    throw new Error(`Se agotaron los ${MAX_FIELD_ATTEMPTS} intentos para un dato obligatorio. No se pidió la contraseña de piar_test ni se consultó la base de datos.`);
}

// Reúne y valida todos los datos antes de pedir la contraseña de MySQL.
async function collectProvisioningInput(io = {}) {
    const values = {};
    for (const field of PROVISIONING_FIELDS) values[field.key] = await promptValidatedField(field, io);
    return values;
}

// Resumen previo a la confirmación final: identidad y referencia tal como se
// registrarán en la auditoría, y del motivo solo su longitud.
function describeOperatorSummary({ operatorIdentityClaim, authorizationReference, reason }) {
    return [
        "Resumen de la autorización que quedará en la auditoría:",
        `  ${OPERATOR_FIELDS.operatorIdentityClaim.label}: ${operatorIdentityClaim}`,
        `  ${OPERATOR_FIELDS.authorizationReference.label}: ${authorizationReference}`,
        `  ${OPERATOR_FIELDS.reason.label}: ${reason.length} de ${OPERATOR_FIELDS.reason.maxLength} caracteres`
    ].join("\n");
}

function reportSmtpFailure(error, context) {
    process.stderr.write(`${context}\n`);
    process.stderr.write(`Diagnóstico SMTP: ${describeSmtpDiagnostic(error?.diagnostic)}\n`);
}

async function configureEmailTransport() {
    try {
        const mode = assertPersistentEmailTransport();
        if (mode === "smtp") await verifySmtpTransport();
        return mode;
    } catch (error) {
        if (error?.diagnostic) reportSmtpFailure(error, "La configuración SMTP persistente no superó la verificación.");
        process.stdout.write("SMTP necesita la configuración de tu cuenta Gmail. No se guardará en archivos.\n");
        const configure = await readLine("¿Configurar Gmail SMTP de forma temporal para este bootstrap? Escribe SI: ");
        if (configure !== "SI") throw new Error("Configura SMTP persistente y vuelve a ejecutar el bootstrap.");
        const host = (await readLine("Servidor SMTP [smtp.gmail.com]: ")) || "smtp.gmail.com";
        const port = Number((await readLine("Puerto SMTP [465]: ")) || "465");
        const user = (await readLine("Cuenta Gmail completa: ")).trim();
        const from = (await readLine("Remitente EMAIL_FROM [misma cuenta]: ")).trim() || user;
        const inputStats = { ignoredControls: 0 };
        const appPassword = (await readHidden("Contraseña de aplicación Gmail (entrada oculta): ", inputStats)).replace(/\s/g, "");
        const received = describeAppPasswordInput(appPassword, inputStats.ignoredControls);
        process.stdout.write(`${received.text}\n`);
        if (!EMAIL.test(user) || !EMAIL.test(from) || !host || !appPassword) throw new Error("La configuración SMTP no es válida.");
        if (!received.expectedFormat && await readLine("La contraseña no tiene el formato esperado. ¿Intentar autenticar de todos modos? Escribe SI: ") !== "SI") {
            throw new Error("Se canceló antes de autenticar con Gmail; no se hizo ningún intento SMTP.");
        }
        process.env.EMAIL_TRANSPORT = "smtp";
        process.env.EMAIL_SMTP_HOST = host;
        process.env.EMAIL_SMTP_PORT = String(port);
        process.env.EMAIL_SMTP_USER = user;
        process.env.EMAIL_SMTP_PASSWORD = appPassword;
        process.env.EMAIL_SMTP_SECURE = String(port === 465);
        process.env.EMAIL_FROM = from;
        assertPersistentEmailTransport();
        try {
            await verifySmtpTransport();
        } catch (error) {
            reportSmtpFailure(error, "Gmail no aceptó la verificación SMTP. No se consultó ni modificó la base de datos.");
            throw error;
        }
        return "smtp";
    }
}

async function main() {
    let connection;
    try {
        process.env.NODE_ENV = "test";
        if (process.env.APP_BASE_URL && process.env.APP_BASE_URL !== LOCAL_APP_URL) {
            throw new Error(`APP_BASE_URL debe ser ${LOCAL_APP_URL} (backend local) para el bootstrap.`);
        }
        process.env.APP_BASE_URL = LOCAL_APP_URL;
        validateTargetEnvironment();
        await configureEmailTransport();
        auth.applicationBaseUrl();
        process.stdout.write(`Destino fijado por el script: ${TARGET.host}:${TARGET.port} / ${TARGET.database}, usuario ${TARGET.user}. Enlace de verificación: ${LOCAL_APP_URL}.\n`);
        if (await readLine(`Para continuar escribe exactamente: ${TARGET_CONFIRMATION}\n> `) !== TARGET_CONFIRMATION) {
            throw new Error("La confirmación de destino no coincide; no se hizo ninguna consulta.");
        }
        const email = TARGET_ADMIN_EMAIL;
        if (!email) throw new Error("Define PIAR_BOOTSTRAP_ADMIN_EMAIL; no se hizo ninguna consulta.");
        process.stdout.write(`Correo de administrador fijado por el script: ${TARGET_ADMIN_EMAIL}.\n`);
        if (!EMAIL.test(email) || email.length > 150) throw new Error("El correo no tiene un formato válido para el esquema local.");
        // Ningún dato inválido llega a la contraseña de MySQL ni a la conexión.
        const { name, document, operatorIdentityClaim, authorizationReference, reason } = await collectProvisioningInput();
        const databasePassword = await readHidden("Contraseña local de piar_test (entrada oculta): ");
        if (!databasePassword) throw new Error("La contraseña de piar_test no puede estar vacía.");
        connection = await mysql.createConnection(mysqlConnectionConfig(databasePassword, "existing"));
        await assertTargetAndSchema(connection);

        process.stdout.write(`${describeOperatorSummary({ operatorIdentityClaim, authorizationReference, reason })}\n`);
        if (await readLine("Confirma que la identidad y la autorización fueron comprobadas fuera de PIAR (escribe SI): ") !== "SI") {
            throw new Error("Sin autorización explícita no se crea una cuenta.");
        }
        if (await readLine(`Para autorizar la escritura escribe exactamente: ${CREATE_CONFIRMATION}\n> `) !== CREATE_CONFIRMATION) {
            throw new Error("La confirmación de escritura no coincide; no se creó ninguna cuenta.");
        }
        const password = generateTemporaryPassword();
        const created = await createPrimaryAdmin(connection, { email, name, document, password, operatorIdentityClaim, authorizationReference, reason });
        let emailAccepted = false;
        try {
            await auth.deliverInitialAdminVerification(email, created.verificationToken);
            emailAccepted = true;
        } catch (error) {
            if (error?.diagnostic) reportSmtpFailure(error, "El envío del enlace de verificación falló.");
            try { await auth.invalidateInitialAdminVerification(connection, created.userId, created.verificationToken); }
            catch { process.stderr.write("No se pudo confirmar la invalidación del token no entregado; la cuenta permanece pendiente y requiere revisión antes de reintentar.\n"); }
            process.stderr.write("La cuenta quedó pendiente de verificación; el transporte no aceptó el mensaje. No se activó el acceso. Configura correo persistente y solicita reenvío.\n");
            process.exitCode = 1;
        }
        process.stdout.write(`Cuenta creada pendiente de verificación (ID ${created.userId}).\n`);
        process.stdout.write(`Contraseña temporal de un solo uso: ${password}\n`);
        process.stdout.write("Cópiala ahora y guárdala en un gestor de contraseñas; no volverá a mostrarse. Tras verificar el correo, el primer inicio exige cambiarla antes de acceder al panel.\n");
        process.stdout.write(emailAccepted
            ? "El servidor SMTP/API aceptó la solicitud de envío; esto no confirma entrega final. La verificación requiere el enlace real recibido.\n"
            : "El envío no fue aceptado. La cuenta sigue pendiente, sin correo verificado ni acceso al panel; la contraseña temporal se mostró para guardarla.\n");
    } catch (error) {
        process.stderr.write(`${error.code ? `Error MySQL (${error.code})` : error.message}\n`);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

if (require.main === module) main();

module.exports = { TARGET, LOCAL_APP_URL, TARGET_ADMIN_EMAIL, TARGET_CONFIRMATION, CREATE_CONFIRMATION, validateTargetEnvironment, assertTargetAndSchema, assertAdminProvisioningSchema, assertBootstrapTarget, lookupByEmail, createPrimaryAdmin, generateTemporaryPassword, configureEmailTransport, describeAppPasswordInput, reportSmtpFailure, MAX_FIELD_ATTEMPTS, PROVISIONING_FIELDS, promptValidatedField, collectProvisioningInput, describeOperatorSummary, ADMIN_OPERATION_LOCK, readLine, readHidden, main };
