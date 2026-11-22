"use strict";

// Herramientas de cierre: verificación de producción (solo lectura), prueba de correo y
// diagnóstico de proxy. Sin MySQL ni red.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("verificador: clasifica privilegios y exige solo DML sobre el esquema", () => {
    const { classifyGrants } = require("../scripts/verificar-produccion");
    const usage = { g: "GRANT USAGE ON *.* TO `piar_app`@`%`" };
    assert.equal(classifyGrants([usage, { g: "GRANT SELECT, INSERT, UPDATE, DELETE ON `piar_produccion`.* TO `piar_app`@`%`" }], "piar_produccion"), "solo_dml");
    assert.equal(classifyGrants([usage, { g: "GRANT SELECT, INSERT ON `piar_produccion`.* TO `x`@`%`" }], "piar_produccion"), "incompleta");
    assert.equal(classifyGrants([usage, { g: "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON `piar_produccion`.* TO `x`@`%`" }], "piar_produccion"), "ddl");
    assert.equal(classifyGrants([{ g: "GRANT ALL PRIVILEGES ON *.* TO `root`@`%`" }], "piar_produccion"), "global");
    assert.equal(classifyGrants([usage, { g: "GRANT SELECT, INSERT, UPDATE, DELETE ON `otra`.* TO `x`@`%`" }], "piar_produccion"), "global");
});

test("verificador: informa tablas faltantes, migraciones pendientes, privilegios y Administradoras", () => {
    const { evaluate, EXPECTED_TABLES, parseArgs } = require("../scripts/verificar-produccion");
    assert.equal(EXPECTED_TABLES.length, 28);
    const ok = { tablasFaltantes: [], migraciones: [{ version: "016", estado: "aplicada" }], privilegios: "solo_dml", administradores: 1, esperarAdmin: true, huellaAdmin: true };
    assert.deepEqual(evaluate(ok), []);
    const bad = evaluate({ tablasFaltantes: ["cambio_correo"], migraciones: [{ version: "016", estado: "pendiente" }], privilegios: "global", administradores: 2, esperarAdmin: true, huellaAdmin: false });
    assert.equal(bad.length, 6);
    assert.deepEqual(parseArgs(["--paquete", "x.json"]), { expectAdmin: true, bundle: "x.json" });
    assert.throws(() => parseArgs(["--borrar"]), /Argumentos admitidos/);
    const source = fs.readFileSync(path.join(ROOT, "scripts/verificar-produccion.js"), "utf8");
    assert.match(source, /SET SESSION TRANSACTION READ ONLY/);
    assert.doesNotMatch(source, /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|DROP |ALTER TABLE|CREATE TABLE)\b/);
});

test("correo: el envío exige confirmación y la verificación no envía", async () => {
    const { main, parseArgs, configurationSummary } = require("../scripts/probar-correo");
    const env = {
        EMAIL_TRANSPORT: "smtp", EMAIL_FROM: "piar@example.invalid", EMAIL_SMTP_HOST: "smtp.gmail.com", EMAIL_SMTP_PORT: "465",
        EMAIL_SMTP_SECURE: "true", EMAIL_SMTP_USER: "piar@example.invalid", EMAIL_SMTP_PASSWORD: "contrasena-de-aplicacion"
    };
    const calls = [];
    const deps = { verifySmtpTransport: async () => calls.push("verify"), deliverEmail: async to => calls.push(`send:${to}`) };
    const logs = [];
    const original = console.log;
    console.log = message => logs.push(String(message));
    try {
        assert.deepEqual(await main(["--verificar"], env, deps), { verified: true });
        await assert.rejects(main(["--enviar", "destino@example.invalid"], env, deps), /PIAR_CONFIRMAR_ENVIO=SI/);
        assert.deepEqual(await main(["--enviar", "destino@example.invalid"], { ...env, PIAR_CONFIRMAR_ENVIO: "SI" }, deps), { sent: true });
    } finally {
        console.log = original;
    }
    assert.deepEqual(calls, ["verify", "send:destino@example.invalid"]);
    assert.doesNotMatch(logs.join("\n"), /contrasena-de-aplicacion/);
    assert.equal(configurationSummary(env).remitenteIgualAlUsuario, true);
    assert.throws(() => configurationSummary({ EMAIL_TRANSPORT: "memory" }), /memory/);
    assert.throws(() => parseArgs(["--enviar", "no-es-correo"]), /Uso/);
});

test("diagnóstico de proxy: desactivado por omisión y sin valores de X-Forwarded-For", () => {
    const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
    assert.match(server, /PIAR_DIAGNOSTICO_PROXY \|\| ""\) === "1" \? 5 : 0/);
    assert.match(server, /saltos en X-Forwarded-For: \$\{forwarded\.length\}/);
    assert.doesNotMatch(server, /console\.log\([^)]*x-forwarded-for"\]\s*\)/i);
});

test("detector: marca correos personales y admite referencias de Railway", () => {
    const { findViolations } = require("../scripts/check-sensitive-files");
    const scan = content => findViolations(["archivo.md"], () => content).map(item => item.rule);
    // Los ejemplos se arman en tiempo de ejecución para que este archivo no contenga correos literales.
    assert.deepEqual(scan(`contacto: persona.real@${"gmail"}.com`), ["correo personal"]);
    assert.deepEqual(scan(`contacto: alguien@${"hotmail"}.com`), ["correo personal"]);
    assert.deepEqual(scan("correo: e2e-0@example.invalid y piar@example.invalid"), []);
    assert.deepEqual(scan("DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}"), []);
    assert.deepEqual(scan("DB_PASSWORD=valor-literal-secreto"), ["secreto con valor en plantilla de entorno"]);
});
