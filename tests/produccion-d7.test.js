"use strict";

// Pruebas sin base de datos de la preparación para producción y de la decisión D7.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const PRODUCTION_ENV = Object.freeze({
    NODE_ENV: "production", APP_BASE_URL: "https://piar.example.invalid", CORS_ORIGIN: "https://piar.example.invalid",
    DB_HOST: "mysql.railway.internal", DB_PORT: "3306", DB_NAME: "piar_produccion", DB_USER: "piar_app", DB_PASSWORD: "x",
    EMAIL_TRANSPORT: "smtp", EMAIL_FROM: "piar@example.invalid", EMAIL_SMTP_HOST: "smtp.example.invalid", EMAIL_SMTP_PORT: "465",
    EMAIL_SMTP_SECURE: "true", EMAIL_SMTP_USER: "piar@example.invalid", EMAIL_SMTP_PASSWORD: "x",
    TRUSTED_PROXIES: "100.64.0.0/10", RATE_LIMIT_STORE: "mysql"
});

test("producción: HOST por omisión 0.0.0.0 y loopback en desarrollo; PORT validado", () => {
    const { resolveListenHost, resolveListenPort } = require("../backend/production-config");
    assert.equal(resolveListenHost({ NODE_ENV: "production" }), "0.0.0.0");
    assert.equal(resolveListenHost({ NODE_ENV: "development" }), "127.0.0.1");
    assert.equal(resolveListenHost({ NODE_ENV: "production", HOST: "127.0.0.1" }), "127.0.0.1");
    assert.equal(resolveListenPort({ PORT: "4321" }), 4321);
    assert.equal(resolveListenPort({}), 8080);
    assert.throws(() => resolveListenPort({ PORT: "99999" }), /PORT/);
});

test("producción: una configuración completa arranca sin errores ni advertencias", () => {
    const { assertRuntimeConfig } = require("../backend/production-config");
    assert.deepEqual(assertRuntimeConfig({ ...PRODUCTION_ENV }), []);
});

test("producción: rechaza localhost, http, esquemas de prueba, CORS incoherente y correo en memoria", () => {
    const { assertRuntimeConfig, productionConfigReport } = require("../backend/production-config");
    const report = productionConfigReport({
        ...PRODUCTION_ENV, APP_BASE_URL: "http://localhost:8090", CORS_ORIGIN: "http://localhost:8090",
        DB_HOST: "127.0.0.1", DB_NAME: "piar_test", EMAIL_TRANSPORT: "memory"
    });
    assert.ok(report.errors.some(item => /APP_BASE_URL debe usar https/.test(item)));
    assert.ok(report.errors.some(item => /APP_BASE_URL no puede apuntar a localhost/.test(item)));
    assert.ok(report.errors.some(item => /CORS_ORIGIN solo admite/.test(item)));
    assert.ok(report.errors.some(item => /DB_HOST no puede ser localhost/.test(item)));
    assert.ok(report.errors.some(item => /DB_NAME no puede ser un esquema de pruebas/.test(item)));
    assert.ok(report.errors.some(item => /memory no está permitido/.test(item)));
    assert.throws(() => assertRuntimeConfig({ ...PRODUCTION_ENV, CORS_ORIGIN: "https://otro.example.invalid" }), /CORS_ORIGIN debe incluir el origen/);
    // Los mensajes nombran variables, nunca valores secretos.
    assert.doesNotMatch(JSON.stringify(report), /piar_app|smtp\.example/);
    const warnings = productionConfigReport({ ...PRODUCTION_ENV, TRUSTED_PROXIES: "", RATE_LIMIT_STORE: "memory" }).warnings;
    assert.equal(warnings.length, 2);
    assert.deepEqual(assertRuntimeConfig({ NODE_ENV: "development" }), []);
});

test("server.js valida la configuración antes de abrir MySQL y cierra ordenadamente con SIGTERM", () => {
    const server = read("backend/server.js");
    assert.ok(server.indexOf("assertRuntimeConfig(process.env)") < server.indexOf('require("./db")'));
    assert.match(server, /const HOST = runtimeConfig\.resolveListenHost\(process\.env\)/);
    assert.match(server, /process\.once\("SIGTERM"/);
});

test("MySQL: TLS opcional (required/verify) y root solo con autorización explícita", () => {
    const { buildDatabaseConfig } = require("../backend/database-config");
    const base = { DB_HOST: "db.example.invalid", DB_PORT: "3306", DB_NAME: "piar_produccion", DB_USER: "piar_app", DB_PASSWORD: "x" };
    assert.equal(buildDatabaseConfig(base).ssl, undefined);
    assert.deepEqual(buildDatabaseConfig({ ...base, DB_SSL: "required" }).ssl, { minVersion: "TLSv1.2", rejectUnauthorized: false });
    const verified = buildDatabaseConfig({ ...base, DB_SSL: "verify", DB_SSL_CA: "-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----" }).ssl;
    assert.equal(verified.rejectUnauthorized, true);
    assert.equal(verified.ca.split("\n").length, 3);
    assert.throws(() => buildDatabaseConfig({ ...base, DB_SSL: "verify" }), /DB_SSL_CA/);
    assert.throws(() => buildDatabaseConfig({ ...base, DB_SSL: "quizas" }), /DB_SSL admite/);
    assert.throws(() => buildDatabaseConfig({ ...base, DB_USER: "root" }), /no use root/);
    assert.equal(buildDatabaseConfig({ ...base, DB_USER: "root" }, { allowRoot: true }).user, "root");
});

test("migraciones remotas: confirmación del nombre, sin loopback ni esquemas de prueba", () => {
    const { connectionSettings } = require("../backend/run-migration");
    const remote = { DB_HOST: "proxy.example.invalid", DB_PORT: "41234", DB_NAME: "piar_produccion", DB_USER: "piar_app", DB_PASSWORD: "x" };
    assert.throws(() => connectionSettings(["--remote"], remote), /PIAR_MIGRATION_CONFIRM_DATABASE/);
    assert.throws(() => connectionSettings(["--remote"], { ...remote, DB_HOST: "127.0.0.1", PIAR_MIGRATION_CONFIRM_DATABASE: "piar_produccion" }), /loopback/);
    for (const name of ["piar", "piar_test", "piar_test_x", "piar_dev"]) {
        assert.throws(() => connectionSettings(["--remote"], { ...remote, DB_NAME: name, PIAR_MIGRATION_CONFIRM_DATABASE: name }), /no admite los esquemas/);
    }
    const accepted = connectionSettings(["--remote"], { ...remote, PIAR_MIGRATION_CONFIRM_DATABASE: "piar_produccion", MIGRATION_DB_USER: "root", MIGRATION_DB_PASSWORD: "m" });
    assert.equal(accepted.remote, true);
    assert.equal(accepted.config.user, "root");
    assert.equal(accepted.config.multipleStatements, false);
    // Sin --remote, el modo local sigue limitado a piar_dev*/piar_test* en loopback.
    assert.throws(() => connectionSettings([], { ...remote, PIAR_MIGRATION_CONFIRM_DATABASE: "piar_produccion" }), /solo se permiten/);
    assert.throws(() => connectionSettings([], { ...remote, DB_HOST: "127.0.0.1", DB_NAME: "piar_test", DB_USER: "root" }), /no use root/);
    assert.throws(() => connectionSettings(["--remote"], { ...remote, PIAR_MIGRATION_CONFIRM_DATABASE: "piar_produccion", MIGRATION_DB_USER: "root" }), /MIGRATION_DB_PASSWORD/);
});

test("Railway: Dockerfile sin root ni dependencias de desarrollo, health check y .dockerignore", () => {
    const dockerfile = read("Dockerfile");
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.match(dockerfile, /HOST=0\.0\.0\.0/);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /COPY database\/migrations/);
    assert.doesNotMatch(dockerfile, /COPY \. \./);
    const railway = JSON.parse(read("railway.json"));
    assert.equal(railway.build.builder, "DOCKERFILE");
    assert.equal(railway.deploy.healthcheckPath, "/api/health");
    const ignore = read(".dockerignore").split(/\r?\n/);
    for (const entry of [".env", ".env.*", ".git", "tests", "scripts/*", "docs"]) assert.ok(ignore.includes(entry), entry);
    assert.deepEqual(ignore.filter(line => line.startsWith("!scripts/")), ["!scripts/verificar-produccion.js", "!scripts/probar-correo.js", "!scripts/admin-transfer.js"]);
});

test("traslado de la Administradora: huella estable, conflictos detectados y paquete fuera del repositorio", () => {
    const transfer = require("../scripts/admin-transfer");
    const row = { id_usuario: 7, correo: "a@example.invalid", password_hash: "h", created_at: "2026-01-01 00:00:00", decision_at: null };
    const reordered = { decision_at: null, created_at: "2026-01-01 00:00:00", password_hash: "h", correo: "a@example.invalid", id_usuario: 7 };
    assert.equal(transfer.rowFingerprint(row), transfer.rowFingerprint(reordered));
    assert.notEqual(transfer.rowFingerprint(row), transfer.rowFingerprint({ ...row, password_hash: "otro" }));
    assert.equal(transfer.rowFingerprint({ x: 1 }), transfer.rowFingerprint({ x: "1" }));

    const columns = [{ name: "id_usuario", type: "int", nullable: "NO" }];
    const bundle = { schema: { migrations: [{ version: "000", checksum: "a" }, { version: "015", checksum: "b" }], columns }, row };
    const clean = { migrations: [{ version: "000", checksum: "a" }, { version: "015", checksum: "b" }, { version: "016", checksum: "c" }], columns, conflicts: { sameId: 0, sameEmail: 0, sameDocument: 0, administrators: 0 } };
    assert.deepEqual(transfer.compatibilityProblems(bundle, clean), []);
    const problems = transfer.compatibilityProblems(bundle, {
        migrations: [{ version: "000", checksum: "zzz" }], columns: [{ name: "id_usuario", type: "bigint", nullable: "NO" }],
        conflicts: { sameId: 1, sameEmail: 1, sameDocument: 1, administrators: 1 }
    });
    assert.equal(problems.length, 7);
    assert.ok(problems.some(item => /ya tiene una cuenta Administrador/.test(item)));

    assert.throws(() => transfer.resolveOutputDir({ PIAR_TRANSFER_DIR: path.join(ROOT, "docs") }), /dentro del repositorio/);
    assert.ok(transfer.resolveOutputDir({}).includes("PIAR-SISTEMA-respaldos"));
    assert.throws(() => transfer.parseArgs(["borrar"]), /Subcomando no válido/);
    assert.deepEqual(transfer.parseArgs(["export", "--id", "178"]), { command: "export", options: { id: "178" } });
    assert.throws(() => transfer.connectionConfig("TARGET", {}), /TARGET_DB_HOST/);
});

test("traslado: la importación exige confirmación y revierte si la huella no coincide", async () => {
    const transfer = require("../scripts/admin-transfer");
    const row = { id_usuario: 7, correo: "a@example.invalid", documento: "D1", rol: "Administrador" };
    const columns = Object.keys(row).map(name => ({ name, type: "varchar(10)", nullable: "NO" }));
    const bundle = { schema: { migrations: [], columns }, row, fingerprint: transfer.rowFingerprint(row) };
    const calls = [];
    const connection = {
        piarTarget: { database: "piar_produccion" },
        beginTransaction: async () => calls.push("begin"), commit: async () => calls.push("commit"), rollback: async () => calls.push("rollback"),
        async query(sql) {
            calls.push(sql.split(" ").slice(0, 2).join(" "));
            if (sql.includes("SUM(id_usuario")) return [[{ sameId: 0, sameEmail: 0, sameDocument: 0, administrators: 0 }]];
            if (sql.includes("schema_migrations'")) return [[]];
            if (sql.includes("information_schema.COLUMNS")) return [columns.map(column => ({ ...column }))];
            if (sql.startsWith("INSERT")) return [{ affectedRows: 1 }];
            if (sql.startsWith("SELECT `id_usuario`")) return [[{ ...row, documento: "alterado" }]];
            throw new Error(`consulta inesperada: ${sql}`);
        }
    };
    await assert.rejects(transfer.importAccount(connection, bundle, {}), /PIAR_TRANSFER_CONFIRM/);
    await assert.rejects(transfer.importAccount(connection, bundle, { PIAR_TRANSFER_CONFIRM: "piar_produccion" }), /huella/);
    assert.deepEqual(calls.filter(call => ["begin", "commit", "rollback"].includes(call)), ["begin", "rollback"]);
});

test("CSP: script-src sin 'unsafe-inline' en el servidor y en la demo visual", () => {
    for (const file of ["backend/server.js", "scripts/visual-demo-server.js"]) {
        const policy = read(file).match(/"script-src[^"]*"/)[0];
        assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/, file);
    }
});

test("frontend: no quedan manejadores en línea y cada acción declarada está permitida y definida", () => {
    const { PIAR_EVENT_ACTIONS } = require("../public/js/event-actions");
    const dir = path.join(ROOT, "public/js");
    const sources = fs.readdirSync(dir).filter(file => file.endsWith(".js") && file !== "event-actions.js")
        .map(file => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
    const html = read("public/index.html");
    assert.doesNotMatch(sources + html, /(^|[^-\w])on(click|submit|input|change|load|error|keydown)\s*=\s*["']/m);
    assert.match(html, /<script src="js\/event-actions\.js"><\/script>/);
    const used = new Set([...sources.matchAll(/data-on(?:click|submit|input|change)="([A-Za-z_$][\w$]*)\(/g)].map(match => match[1]));
    for (const match of sources.matchAll(/"(leavePasswordReset|leaveEmailVerification)\(event\)"/g)) used.add(match[1]);
    for (const match of sources.matchAll(/statCard\([^\n]*?"([A-Za-z]+)\(/g)) used.add(match[1]);
    const defined = new Set([...sources.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]));
    for (const name of used) {
        assert.ok(PIAR_EVENT_ACTIONS.includes(name), `acción sin permitir: ${name}`);
        assert.ok(defined.has(name), `acción sin definir: ${name}`);
    }
    for (const name of PIAR_EVENT_ACTIONS) assert.ok(used.has(name), `acción permitida sin uso: ${name}`);
});

test("despachador: solo una llamada con argumentos literales, event o this", () => {
    const { parseActionExpression, parseActionArgument } = require("../public/js/event-actions");
    assert.deepEqual(parseActionExpression("viewPIAR(12)"), { name: "viewPIAR", args: ["12"] });
    assert.deepEqual(parseActionExpression("savePiarStatus(event, 4, 'cerrar')"), { name: "savePiarStatus", args: ["event", "4", "'cerrar'"] });
    assert.deepEqual(parseActionExpression("openPIARModal()"), { name: "openPIARModal", args: [] });
    assert.deepEqual(parseActionExpression("renderApp('a,b')"), { name: "renderApp", args: ["'a,b'"] });
    for (const bad of ["alert(1); fetch('x')", "a.b(1)", "x", "renderApp('sin cierre)", ""]) assert.equal(parseActionExpression(bad), null, bad);
    const event = {}; const element = {};
    assert.equal(parseActionArgument("event", event, element), event);
    assert.equal(parseActionArgument("this", event, element), element);
    assert.equal(parseActionArgument("null"), null);
    assert.equal(parseActionArgument("-3"), -3);
    assert.equal(parseActionArgument("'texto'"), "texto");
    for (const bad of ["window", "document.cookie", "'a'+'b'", "`x`"]) assert.throws(() => parseActionArgument(bad), /no admitido/, bad);
});

test("actualización parcial: los opcionales se pueden vaciar y los obligatorios no", () => {
    const { buildPartialUpdate, assignmentSql } = require("../backend/partial-update");
    const result = buildPartialUpdate({ titulo: " Plan ", metas: "", otra: "x", fecha_revision: null }, { required: ["titulo"], optional: ["metas", "fecha_revision"] });
    assert.deepEqual(result, { columns: ["titulo", "metas", "fecha_revision"], values: ["Plan", null, null] });
    assert.match(buildPartialUpdate({ titulo: "  " }, { required: ["titulo"], labels: { titulo: "El título" } }).error, /El título no se puede dejar vacío/);
    assert.deepEqual(buildPartialUpdate({}, { required: ["titulo"] }), { columns: [], values: [] });
    assert.equal(assignmentSql(["titulo", "metas"]), "titulo = ?, metas = ?");
    assert.throws(() => assignmentSql(["titulo; DROP"]), /Columna no válida/);
    const server = read("backend/server.js");
    assert.doesNotMatch(server, /UPDATE piar SET titulo = COALESCE/);
    assert.doesNotMatch(server, /UPDATE docente SET nombre = COALESCE/);
});

test("aviso de decisión: no incluye el motivo y un fallo de entrega no revierte la decisión", async () => {
    const { notifyRegistrationDecision, decisionMessage } = require("../backend/decision-notification");
    const sent = [];
    const deliver = async (to, subject, text) => sent.push({ to, subject, text });
    assert.equal(await notifyRegistrationDecision("aprobar", { correo: "d@example.invalid", nombre: "Dana", rol: "Psicóloga" }, { baseUrl: "https://piar.example.invalid", deliver }), "enviada");
    assert.match(sent[0].text, /Psicólogo\(a\)/);
    assert.match(sent[0].text, /https:\/\/piar\.example\.invalid/);
    assert.doesNotMatch(decisionMessage("rechazar", { nombre: "Dana", rol: "Docente" }).text, /motivo/i);
    assert.equal(await notifyRegistrationDecision("rechazar", { correo: "d@example.invalid" }, { deliver: async () => { throw new Error("smtp"); } }), "no_enviada");
    assert.equal(await notifyRegistrationDecision("otra", { correo: "d@example.invalid" }, { deliver }), "no_enviada");
});

// Doble de base de datos con transacciones, igual que en auth-registration.test.js.
function dbWith(queryFn) {
    const statements = [];
    const runQuery = async (sql, values = []) => { statements.push({ sql, values }); return queryFn(sql, values); };
    const connection = {
        beginTransaction: async () => statements.push({ transaction: "begin" }), commit: async () => statements.push({ transaction: "commit" }),
        rollback: async () => statements.push({ transaction: "rollback" }), release: () => {}, query: runQuery, execute: runQuery
    };
    return { statements, promise: () => ({ query: runQuery, getConnection: async () => connection }) };
}

const STUDENT_ACCOUNT = {
    nombre: "Eva", apellidos: "Estudiante Sintética", documento: "EST-1", correo: "eva@example.invalid",
    password: "Frase temporal sintética 2026", rol: "Estudiante", id_estudiante: 31, autorizacion_acudiente: "on"
};

test("D7: el Administrador crea la cuenta Estudiante vinculada, temporal y auditada", async () => {
    const { register } = require("../backend/auth");
    const previous = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://piar.example.invalid";
    try {
        const db = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario FROM usuario")) return [[]];
            if (sql.startsWith("SELECT id_estudiante, estado, id_usuario FROM estudiante")) return [[{ id_estudiante: 31, estado: "activo", id_usuario: null }]];
            if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 77 }];
            if (sql.startsWith("UPDATE estudiante SET id_usuario")) return [{ affectedRows: 1 }];
            return [{ affectedRows: 1 }];
        });
        let link;
        const result = await register(db, STUDENT_ACCOUNT, false, async (_to, url) => { link = url; }, { actorId: 900 });
        assert.equal(result.status, 201);
        assert.match(result.body.message, /Estudiante creada y vinculada/);
        assert.match(link, /#verify-email=/);
        const insert = db.statements.find(item => item.sql?.startsWith("INSERT INTO usuario"));
        assert.match(insert.sql, /password_change_required\) VALUES \(\?, \?, \?, \?, \?, \?, \?, 1\)/);
        assert.equal(insert.values[3], "Estudiante");
        assert.deepEqual(db.statements.find(item => item.sql?.startsWith("UPDATE estudiante")).values, [77, 31]);
        const audit = db.statements.find(item => item.sql?.includes("admin_account_audit"));
        assert.ok(audit, "auditoría registrada");
        assert.ok(audit.values.includes("autorizacion_acudiente_confirmada"));
        assert.ok(db.statements.some(item => item.transaction === "commit"));
    } finally {
        if (previous === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previous;
    }
});

test("D7: sin autorización del acudiente, estudiante vinculado, inexistente o registro público, no se crea", async () => {
    const { register } = require("../backend/auth");
    const neverWrites = dbWith(async () => { throw new Error("no debe consultar"); });
    assert.equal((await register(neverWrites, { ...STUDENT_ACCOUNT, autorizacion_acudiente: undefined }, false, undefined, { actorId: 900 })).status, 400);
    assert.equal((await register(neverWrites, { ...STUDENT_ACCOUNT, id_estudiante: "x" }, false, undefined, { actorId: 900 })).status, 400);
    assert.equal((await register(neverWrites, STUDENT_ACCOUNT)).status, 400, "el registro público nunca crea Estudiante");

    for (const [student, status] of [[{ id_estudiante: 31, estado: "activo", id_usuario: 5 }, 409], [{ id_estudiante: 31, estado: "inactivo", id_usuario: null }, 409], [null, 404]]) {
        const db = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario FROM usuario")) return [[]];
            if (sql.startsWith("SELECT id_estudiante")) return [student ? [student] : []];
            throw new Error(`escritura inesperada: ${sql}`);
        });
        const result = await register(db, STUDENT_ACCOUNT, false, async () => {}, { actorId: 900 });
        assert.equal(result.status, status);
        assert.ok(db.statements.some(item => item.transaction === "rollback"));
        assert.ok(!db.statements.some(item => item.sql?.startsWith("INSERT")));
    }
});

test("despachador: el manejador recibe currentTarget = elemento con la acción (regresión del inicio de sesión)", async () => {
    const { createActionEvent, runElementAction } = require("../public/js/event-actions");
    // Evento real de un envío delegado: currentTarget es document, que no tiene setAttribute.
    const documentStub = { querySelector: () => null };
    const form = {
        attrs: {}, dataset: {},
        getAttribute(name) { return name === "data-onsubmit" ? "login(event)" : null; },
        setAttribute(name, value) { this.attrs[name] = value; },
        querySelector() { return null; }
    };
    const nativeEvent = { type: "submit", target: form, currentTarget: documentStub, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };

    const wrapped = createActionEvent(nativeEvent, form);
    assert.equal(wrapped.currentTarget, form);
    assert.equal(wrapped.target, form);
    wrapped.preventDefault();
    assert.equal(nativeEvent.defaultPrevented, true, "preventDefault actúa sobre el evento original");
    assert.equal(wrapped.defaultPrevented, true);

    // Manejador con la misma forma que login(): preventDefault y luego usa event.currentTarget como formulario.
    nativeEvent.defaultPrevented = false;
    const previousWindow = globalThis.window;
    let received = null;
    globalThis.window = { login: async function (event) { event.preventDefault(); const target = event.currentTarget; target.setAttribute("aria-busy", "true"); received = { target, self: this }; } };
    const errors = [];
    const originalError = console.error;
    console.error = message => errors.push(String(message));
    try {
        runElementAction(form, "submit", nativeEvent);
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        console.error = originalError;
        globalThis.window = previousWindow;
    }
    assert.deepEqual(errors, [], "sin «setAttribute is not a function»");
    assert.equal(received.target, form);
    assert.equal(received.self, form);
    assert.equal(form.attrs["aria-busy"], "true");
    assert.equal(nativeEvent.defaultPrevented, true);
});

test("formularios: las funciones que toman el formulario del evento lo hacen con currentTarget", () => {
    // Si alguien vuelve a pasar el evento nativo sin envoltura, este contrato deja de cumplirse.
    const app = read("public/js/app.js");
    const dispatcher = read("public/js/event-actions.js");
    assert.ok((app.match(/event\.currentTarget/g) || []).length >= 4, "login, registro, cambio inicial y beginTraceFormSubmission");
    assert.match(dispatcher, /const actionEvent = createActionEvent\(event, element\);/);
    assert.match(dispatcher, /parseActionArgument\(token, actionEvent, element\)/);
});
