"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const { TARGET, LOCAL_APP_URL, TARGET_ADMIN_EMAIL, TARGET_CONFIRMATION, CREATE_CONFIRMATION, validateTargetEnvironment, assertTargetAndSchema, assertBootstrapTarget, lookupByEmail, createPrimaryAdmin } = require("../scripts/bootstrap-local-primary-admin");

function mockConnection({ database = "piar_test", serverPort = 3306, admins = [], existing = [], lock = 1 } = {}) {
    const calls = [];
    return {
        calls,
        query: async sql => {
            calls.push({ sql });
            return [[{ database_name: database, server_port: serverPort, read_only: 0, account_name: "piar_test@localhost" }]];
        },
        execute: async (sql, values = []) => {
            calls.push({ sql, values });
            if (sql.includes("GET_LOCK")) return [[{ acquired: lock }]];
            if (sql.includes("SELECT id_usuario FROM usuario WHERE rol")) return [admins];
            if (sql.includes("WHERE correo = ? OR documento = ?")) return [existing];
            if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 1 }];
            if (sql.startsWith("INSERT INTO verificacion_correo")) return [{ insertId: 2 }];
            if (sql.startsWith("INSERT INTO admin_account_audit")) return [{ insertId: 3 }];
            return [[{ released: 1 }]];
        },
        beginTransaction: async () => calls.push({ kind: "begin" }),
        commit: async () => calls.push({ kind: "commit" }),
        rollback: async () => calls.push({ kind: "rollback" })
    };
}

const valid = { email: "admin@example.com", name: "Admin local", document: "DOC-LOCAL-001", password: "a-secure-test-password", operatorIdentityClaim: "Operador local", authorizationReference: "ACTA-2026-01", reason: "Aprovisionamiento inicial autorizado" };

test("primary-admin bootstrap is pinned to the local test database and has explicit confirmations", () => {
    assert.deepEqual(TARGET, { host: "127.0.0.1", port: 3307, serverPort: 3306, database: "piar_test", user: "piar_test" });
    assert.equal(LOCAL_APP_URL, "http://127.0.0.1:8090");
    // El correo real no se versiona: llega por variable de entorno y sin ella el valor queda vacío.
    assert.equal(TARGET_ADMIN_EMAIL, String(process.env.PIAR_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase());
    assert.match(require("node:fs").readFileSync(require("node:path").join(__dirname, "../scripts/bootstrap-local-primary-admin.js"), "utf8"), /process.env.PIAR_BOOTSTRAP_ADMIN_EMAIL/);
    assert.match(TARGET_CONFIRMATION, /piar_test EN PUERTO 3307$/);
    assert.match(CREATE_CONFIRMATION, /piar_test EN PUERTO 3307$/);
});

test("bootstrap and recovery connect through the existing 3307 profile, never the retired 3308 fresh container", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const { mysqlConnectionConfig } = require("../scripts/local-piar-test-config");
    for (const file of ["bootstrap-local-primary-admin.js", "recover-local-primary-admin.js"]) {
        const source = fs.readFileSync(path.join(__dirname, "../scripts", file), "utf8");
        assert.match(source, /mysqlConnectionConfig\(databasePassword, "existing"\)/, file);
        assert.doesNotMatch(source, /3308|8081|"fresh"/, file);
    }
    const recovery = fs.readFileSync(path.join(__dirname, "../scripts/recover-local-primary-admin.js"), "utf8");
    assert.doesNotMatch(recovery, /require\("\.\.\/backend\/config"\)/, "recovery must not load .env");
    const config = mysqlConnectionConfig("synthetic-test-password", "existing");
    assert.equal(config.host, TARGET.host);
    assert.equal(config.port, TARGET.port);
    assert.equal(config.database, TARGET.database);
    assert.equal(config.user, TARGET.user);
});

test("verification link targets the native backend on 8090 and rejects other origins", async () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../scripts/bootstrap-local-primary-admin.js"), "utf8");
    assert.match(source, /process\.env\.APP_BASE_URL = LOCAL_APP_URL/);
    const { buildEnvironment } = require("../scripts/start-local-backend");
    const backend = buildEnvironment({}, { DB_USER: "piar_test", DB_PASSWORD: "synthetic" });
    assert.equal(LOCAL_APP_URL, `http://${backend.HOST}:${backend.PORT}`);
    assert.equal(backend.DB_PORT, String(TARGET.port));
    assert.equal(backend.DB_NAME, TARGET.database);
});

test("target configuration rejects institutional piar and other destination overrides", () => {
    assert.equal(validateTargetEnvironment({}), true);
    assert.equal(validateTargetEnvironment({ DB_HOST: "127.0.0.1", DB_PORT: "3307", DB_NAME: "piar_test", DB_USER: "piar_test" }), true);
    assert.throws(() => validateTargetEnvironment({ DB_PORT: "3308" }), /no coincide con el destino local/);
    assert.throws(() => validateTargetEnvironment({ DB_PORT: "3306" }), /no coincide con el destino local/);
    assert.throws(() => validateTargetEnvironment({ DB_NAME: "piar" }), /base institucional 'piar'/);
    assert.throws(() => validateTargetEnvironment({ DB_HOST: "db.institution.example", DB_NAME: "piar_test" }), /no coincide con el destino local/);
});

test("packaged bootstrap generates a one-time password and never reads env files or persists the plaintext", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(path.join(__dirname, "../scripts/bootstrap-local-primary-admin.js"), "utf8");
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    assert.match(source, /crypto\.randomBytes\(24\)\.toString\("base64url"\)/);
    assert.match(source, /password_change_required/);
    assert.match(source, /no volverá a mostrarse/);
    assert.match(source, /process\.env\.NODE_ENV = "test"/);
    assert.match(source, /readHidden\("Contraseña de aplicación Gmail/);
    assert.match(source, /La verificación requiere el enlace real recibido/);
    assert.match(source, /identidad y la autorización fueron comprobadas fuera de PIAR/);
    assert.match(source, /if \(require\.main === module\) main\(\)/);
    assert.doesNotMatch(server, /bootstrap-local-primary-admin/);
});

test("existing-account lookup is parameterized and returns only role and access state", async () => {
    const calls = [];
    const connection = { execute: async (sql, values) => {
        calls.push({ sql, values });
        return [[{ rol: "Docente", estado: "pendiente", correo_verificado_at: null }]];
    } };
    assert.deepEqual(await lookupByEmail(connection, "person@example.invalid"), { rol: "Docente", estado: "pendiente", correo_verificado_at: null });
    assert.match(calls[0].sql, /LOWER\(correo\) = LOWER\(\?\)/);
    assert.deepEqual(calls[0].values, ["person@example.invalid"]);
});

test("primary-admin creation stores a bcrypt hash and remains pending for real email verification", async () => {
    const connection = mockConnection();
    const result = await createPrimaryAdmin(connection, valid);
    const insert = connection.calls.find(call => call.sql?.startsWith("INSERT INTO usuario"));
    assert.ok(insert);
    assert.match(insert.sql, /'Administrador'.*'pendiente_verificacion'.*NULL/);
    assert.match(insert.sql, /password_change_required\) VALUES .*1/);
    assert.equal(insert.values[1], valid.document);
    assert.equal(await bcrypt.compare(valid.password, insert.values[3]), true);
    assert.ok(!insert.values.includes(valid.password));
    const verification = connection.calls.find(call => call.sql?.startsWith("INSERT INTO verificacion_correo"));
    assert.ok(verification);
    assert.match(verification.values[1], /^[a-f0-9]{64}$/);
    assert.notEqual(verification.values[1], result.verificationToken);
    assert.ok(connection.calls.some(call => call.sql?.startsWith("INSERT INTO admin_account_audit")));
    assert.ok(connection.calls.some(call => call.kind === "commit"));
    assert.ok(connection.calls.some(call => call.sql?.includes("GET_LOCK")));
    assert.ok(connection.calls.some(call => call.sql?.includes("RELEASE_LOCK")));
});

test("bootstrap refuses an existing administrator or email and never changes an existing role", async () => {
    for (const [connection, pattern] of [
        [mockConnection({ admins: [{ id_usuario: 1 }] }), /Ya existe una cuenta Administrador/],
        [mockConnection({ existing: [{ id_usuario: 9 }] }), /correo o documento ya pertenece/]
    ]) {
        await assert.rejects(createPrimaryAdmin(connection, valid), pattern);
        assert.ok(connection.calls.some(call => call.kind === "rollback"));
        assert.ok(!connection.calls.some(call => call.sql?.startsWith("INSERT INTO usuario")));
    }
});

test("bootstrap requires explicit operator attribution and authorization, and enforces password bounds before database access", async () => {
    const connection = mockConnection();
    for (const input of [
        { ...valid, operatorIdentityClaim: "" },
        { ...valid, authorizationReference: "" },
        { ...valid, password: "short" },
        { ...valid, password: "x".repeat(73) }
    ]) await assert.rejects(createPrimaryAdmin(connection, input));
    assert.equal(connection.calls.length, 0);
});

test("bootstrap fails closed for institutional database identity before acquiring a write lock", async () => {
    const connection = mockConnection({ database: "piar" });
    await assert.rejects(assertBootstrapTarget(connection), /no corresponde.*piar_test/);
    await assert.rejects(createPrimaryAdmin(connection, valid), /no corresponde.*piar_test/);
    assert.ok(!connection.calls.some(call => call.sql?.includes("GET_LOCK")));
    assert.ok(!connection.calls.some(call => call.sql?.startsWith("INSERT INTO usuario")));
});

test("bootstrap fails closed when the server's internal @@port is not the container's 3306, before grants or schema checks", async () => {
    const connection = mockConnection({ serverPort: 3307 });
    await assert.rejects(assertTargetAndSchema(connection), /no corresponde a la instancia local aislada piar_test/);
    assert.equal(connection.calls.filter(call => /SHOW GRANTS|information_schema/i.test(call.sql || "")).length, 0);
});

test("target preflight uses exact piar_test identity and restricted test-schema grants", async () => {
    const queries = [];
    const connection = {
        query: async sql => {
            queries.push(sql);
            if (/SHOW GRANTS/i.test(sql)) throw new Error("STOP_AFTER_IDENTITY");
            return [[{ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "piar_test@localhost" }]];
        }
    };
    await assert.rejects(assertTargetAndSchema(connection), /STOP_AFTER_IDENTITY/);
    assert.match(queries[0], /CURRENT_USER\(\) AS account_name/);
    assert.doesNotMatch(queries[0], /AS current_user\b/i);
});

// --- Captura validada de los datos del aprovisionamiento ---
const { MAX_FIELD_ATTEMPTS, PROVISIONING_FIELDS, promptValidatedField, collectProvisioningInput, describeOperatorSummary } = require("../scripts/bootstrap-local-primary-admin");

// Simula la consola: entrega las respuestas en orden y registra preguntas y avisos.
function consolaSimulada(respuestas) {
    const preguntas = [];
    const avisos = [];
    const pendientes = [...respuestas];
    return {
        preguntas, avisos,
        io: {
            read: async prompt => { preguntas.push(prompt); if (!pendientes.length) throw new Error("PREGUNTA_INESPERADA"); return pendientes.shift(); },
            write: text => avisos.push(text)
        }
    };
}
const datosValidos = ["Admin local", "DOC-LOCAL-001", "Operador local", "ACTA-2026-01", "Aprovisionamiento inicial autorizado"];

test("la captura pide los cinco datos en orden y devuelve los valores sin espacios sobrantes", async () => {
    const consola = consolaSimulada(datosValidos.map(valor => `  ${valor}\t`));
    const valores = await collectProvisioningInput(consola.io);
    assert.deepEqual(valores, { name: datosValidos[0], document: datosValidos[1], operatorIdentityClaim: datosValidos[2], authorizationReference: datosValidos[3], reason: datosValidos[4] });
    assert.deepEqual(consola.preguntas, PROVISIONING_FIELDS.map(field => field.prompt));
    assert.equal(consola.avisos.length, 0);
    assert.equal(MAX_FIELD_ATTEMPTS, 3);
});

test("una respuesta vacía por un salto de línea suelto o un Ctrl+V sin pegar se vuelve a preguntar", async () => {
    // Identidad: primero vacía (\n suelto), luego vacía otra vez (Ctrl+V que readline descarta) y por fin válida.
    const consola = consolaSimulada([datosValidos[0], datosValidos[1], "", "", datosValidos[2], datosValidos[3], datosValidos[4]]);
    const valores = await collectProvisioningInput(consola.io);
    assert.equal(valores.operatorIdentityClaim, datosValidos[2]);
    assert.equal(valores.authorizationReference, datosValidos[3], "las respuestas siguientes no se desplazan");
    assert.equal(consola.preguntas.filter(prompt => prompt.startsWith("Identidad declarada")).length, 3);
    assert.match(consola.avisos[0], /«Identidad declarada del operador» está vacío y es obligatorio\. Intento 1 de 3\. Escríbelo de nuevo\./);
    assert.match(consola.avisos[1], /Intento 2 de 3/);
});

test("tabulaciones, caracteres de control y longitudes excesivas se rechazan al capturar cada campo", async () => {
    const casos = [
        [3, "Operador\tlocal", /«Identidad declarada del operador» contiene tabulaciones/],
        [3, "Operador\x16local", /caracteres de control/],
        [4, "R".repeat(129), /«Referencia de autorización» supera el máximo de 128 caracteres \(tiene 129\)/],
        [5, "m".repeat(501), /«Motivo» supera el máximo de 500 caracteres \(tiene 501\)/],
        [1, "n".repeat(151), /«Nombre visible» supera el máximo de 150/],
        [2, "D".repeat(31), /«Documento» supera el máximo de 30/]
    ];
    for (const [posicion, invalido, patron] of casos) {
        const respuestas = [...datosValidos];
        respuestas.splice(posicion - 1, 0, invalido);
        const consola = consolaSimulada(respuestas);
        const valores = await collectProvisioningInput(consola.io);
        assert.equal(consola.avisos.length, 1);
        assert.match(consola.avisos[0], patron);
        assert.deepEqual(Object.values(valores), datosValidos);
    }
});

test("tras tres intentos inválidos el bootstrap se detiene sin pedir la contraseña de piar_test", async () => {
    for (const posicion of [0, 2, 3, 4]) {
        const respuestas = datosValidos.slice(0, posicion).concat(["", "   ", "A\tB"]);
        const consola = consolaSimulada(respuestas);
        await assert.rejects(collectProvisioningInput(consola.io), error => {
            assert.match(error.message, /Se agotaron los 3 intentos para un dato obligatorio\. No se pidió la contraseña de piar_test ni se consultó la base de datos\./);
            return true;
        });
        assert.equal(consola.preguntas.length, posicion + 3, "no se hace ninguna pregunta adicional");
        assert.ok(!consola.preguntas.some(prompt => /Contraseña|piar_test/.test(prompt)));
        assert.match(consola.avisos[2], /Intento 3 de 3\.\n$/);
    }
    const consola = consolaSimulada(["", "", "", "no-debe-leerse"]);
    await assert.rejects(promptValidatedField(PROVISIONING_FIELDS[2], consola.io), /Se agotaron los 3 intentos/);
    assert.equal(consola.preguntas.length, 3);
});

test("main valida todos los datos antes de pedir la contraseña de MySQL, conectar, resumir y escribir", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../scripts/bootstrap-local-primary-admin.js"), "utf8");
    const cuerpo = source.slice(source.indexOf("async function main()"));
    const posiciones = [
        "await collectProvisioningInput()",
        "readHidden(\"Contraseña local de piar_test",
        "mysql.createConnection(",
        "await assertTargetAndSchema(connection)",
        "describeOperatorSummary(",
        "!== CREATE_CONFIRMATION",
        "createPrimaryAdmin(connection"
    ].map(fragmento => ({ fragmento, indice: cuerpo.indexOf(fragmento) }));
    for (const { fragmento, indice } of posiciones) assert.ok(indice >= 0, `falta ${fragmento}`);
    for (let i = 1; i < posiciones.length; i += 1) {
        assert.ok(posiciones[i - 1].indice < posiciones[i].indice, `${posiciones[i - 1].fragmento} debe ir antes de ${posiciones[i].fragmento}`);
    }
    assert.doesNotMatch(cuerpo, /await readLine\("(Nombre visible|Documento de la persona|Identidad declarada|Referencia de autorización|Motivo de aprovisionamiento)/, "no deben quedar lecturas sin validar");
});

test("los avisos de captura y el resumen no exponen el documento, el nombre ni el texto del motivo", async () => {
    const documento = "DOC-SINTETICO-99887766";
    const motivo = "MOTIVO-SINTETICO-CONFIDENCIAL";
    const consola = consolaSimulada([
        "Nombre\tSINTETICO", "Admin local",
        `${documento}${"9".repeat(10)}`, documento,
        "", "Operador local",
        "ACTA-2026-01",
        `${motivo}\tcon tabulación`, motivo
    ]);
    const valores = await collectProvisioningInput(consola.io);
    assert.equal(consola.avisos.length, 4);
    const avisos = consola.avisos.join("");
    for (const dato of [documento, motivo, "SINTETICO"]) assert.ok(!avisos.includes(dato), "un aviso repitió el valor escrito");
    const resumen = describeOperatorSummary(valores);
    assert.match(resumen, /Identidad declarada del operador: Operador local/);
    assert.match(resumen, /Referencia de autorización: ACTA-2026-01/);
    assert.match(resumen, new RegExp(`Motivo: ${motivo.length} de 500 caracteres`));
    for (const dato of [documento, motivo, "Admin local"]) assert.ok(!resumen.includes(dato), "el resumen expuso un dato que no debe mostrar");
});
