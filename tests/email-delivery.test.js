"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const nodemailer = require("nodemailer");
const util = require("node:util");
const { deliverEmail, takeDevelopmentOutbox, assertPersistentEmailTransport, verifySmtpTransport, sendSmtp, EmailTransportError, smtpDiagnostic, describeSmtpDiagnostic } = require("../backend/email");

function withEnv(values, fn) {
    const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    return Promise.resolve().then(fn).finally(() => {
        for (const [key, value] of Object.entries(old)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

test("HTTP email adapter authenticates, validates recipient, and posts the message", async () => {
    const seen = [];
    const server = http.createServer((request, response) => {
        let body = "";
        request.on("data", chunk => body += chunk);
        request.on("end", () => {
            seen.push({ auth: request.headers.authorization, body: JSON.parse(body) });
            response.writeHead(202).end();
        });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const endpoint = `http://127.0.0.1:${server.address().port}/mail`;
        await withEnv({ NODE_ENV: "test", EMAIL_TRANSPORT: "api", PASSWORD_RESET_DELIVERY_URL: endpoint, PASSWORD_RESET_DELIVERY_SECRET: "unit-test-secret" }, async () => {
            await deliverEmail("person@example.invalid", "Subject", "Body");
        });
        assert.equal(seen[0].auth, "Bearer unit-test-secret");
        assert.deepEqual(seen[0].body, { to: "person@example.invalid", subject: "Subject", text: "Body" });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test("HTTP email adapter rejects untrusted transport, bad addresses, and provider details", async () => {
    await withEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "api", PASSWORD_RESET_DELIVERY_URL: "http://mail.example.invalid/send", PASSWORD_RESET_DELIVERY_SECRET: "secret" }, async () => {
        await assert.rejects(deliverEmail("person@example.invalid", "Subject", "Body"), /not configured/);
    });
    await assert.rejects(deliverEmail("bad\r\nBcc:attacker@example.invalid", "Subject", "Body"), /recipient is invalid/);

    const server = http.createServer((_request, response) => response.writeHead(500).end());
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const endpoint = `http://127.0.0.1:${server.address().port}/mail`;
        await withEnv({ NODE_ENV: "test", EMAIL_TRANSPORT: "api", PASSWORD_RESET_DELIVERY_URL: endpoint, PASSWORD_RESET_DELIVERY_SECRET: "unit-test-secret" }, async () => {
            await assert.rejects(deliverEmail("person@example.invalid", "Subject", "Body"), /^Error: Email delivery failed\.$/);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test("SMTP adapter requires credentials and enforces TLS settings", async () => {
    await withEnv({ EMAIL_TRANSPORT: "smtp", EMAIL_FROM: "piar@example.invalid", EMAIL_SMTP_HOST: "smtp.example.invalid", EMAIL_SMTP_PORT: "587", EMAIL_SMTP_SECURE: "false", EMAIL_SMTP_USER: "user", EMAIL_SMTP_PASSWORD: "secret" }, async () => {
        const original = nodemailer.createTransport;
        let options;
        let message;
        nodemailer.createTransport = value => {
            options = value;
            return { sendMail: async value => { message = value; }, close() {} };
        };
        try {
            await deliverEmail("person@example.invalid", "Subject", "Body");
        } finally {
            nodemailer.createTransport = original;
        }
        assert.equal(options.requireTLS, true);
        assert.equal(options.tls.rejectUnauthorized, true);
        assert.equal(message.from, "piar@example.invalid");
        assert.equal(message.to, "person@example.invalid");
        assert.equal(JSON.stringify(message).includes("secret"), false);
    });
    await withEnv({ EMAIL_TRANSPORT: "smtp", EMAIL_SMTP_HOST: "smtp.example.invalid", EMAIL_SMTP_PORT: "2525", EMAIL_SMTP_SECURE: "true", EMAIL_SMTP_USER: "user", EMAIL_SMTP_PASSWORD: "secret", EMAIL_FROM: "piar@example.invalid" }, async () => {
        await assert.rejects(deliverEmail("person@example.invalid", "Subject", "Body"), /TLS mode/);
    });
});

test("administrative bootstrap refuses process-local memory mail and validates persistent transport configuration", () => {
    assert.throws(() => assertPersistentEmailTransport({ EMAIL_TRANSPORT: "memory" }), /solo es válido dentro del servidor/);
    assert.throws(() => assertPersistentEmailTransport({ EMAIL_TRANSPORT: "smtp" }), /SMTP no está configurado/);
    assert.throws(() => assertPersistentEmailTransport({
        EMAIL_TRANSPORT: "api", PASSWORD_RESET_DELIVERY_URL: "http://mail.example.invalid/send", PASSWORD_RESET_DELIVERY_SECRET: "secret"
    }), /requiere HTTPS/);
    assert.equal(assertPersistentEmailTransport({
        EMAIL_TRANSPORT: "api", PASSWORD_RESET_DELIVERY_URL: "https://mail.example.org/send", PASSWORD_RESET_DELIVERY_SECRET: "configured-secret"
    }), "api");
});

test("local memory transport keeps links out of logs, requires a local secret, and is one-time", async () => {
    await withEnv({ NODE_ENV: "development", EMAIL_TRANSPORT: "memory", EMAIL_DEV_OUTBOX_SECRET: "a-local-only-secret-with-at-least-32-chars" }, async () => {
        await deliverEmail("person@example.invalid", "Reset", "https://localhost/#reset=opaque-token");
        assert.throws(() => takeDevelopmentOutbox("wrong-secret"), /not available/);
        const messages = takeDevelopmentOutbox("a-local-only-secret-with-at-least-32-chars");
        assert.equal(messages.length, 1);
        assert.match(messages[0].text, /opaque-token/);
        assert.deepEqual(takeDevelopmentOutbox("a-local-only-secret-with-at-least-32-chars"), []);
    });
    await withEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "memory", EMAIL_DEV_OUTBOX_SECRET: "a-local-only-secret-with-at-least-32-chars" }, async () => {
        await assert.rejects(deliverEmail("person@example.invalid", "Reset", "Body"), /not enabled/);
    });
    await withEnv({ NODE_ENV: "development", EMAIL_TRANSPORT: "memory", EMAIL_DEV_OUTBOX_SECRET: "REPLACE_WITH_A_RANDOM_LOCAL_SECRET" }, async () => {
        await assert.rejects(deliverEmail("person@example.invalid", "Reset", "Body"), /not enabled/);
    });
});

// --- Diagnóstico SMTP depurado -------------------------------------------------
// Valores sintéticos que imitan lo que Gmail y Nodemailer pueden devolver. Ninguno
// de ellos debe aparecer en mensajes, diagnósticos ni salidas de consola.
const SMTP_SECRETS = Object.freeze({
    user: "cuenta.privada@example.invalid",
    password: "abcdwxyzefghmnop",
    authBase64: Buffer.from("\0cuenta.privada@example.invalid\0abcdwxyzefghmnop").toString("base64"),
    requestId: "5b1f17b1804b1-43d2f4ab12ac9sm11223344wmb.17",
    helpUrl: "https://support.google.com/mail/?p=BadCredentials"
});
const SMTP_ENV = {
    EMAIL_TRANSPORT: "smtp", EMAIL_FROM: SMTP_SECRETS.user, EMAIL_SMTP_HOST: "smtp.example.invalid",
    EMAIL_SMTP_PORT: "465", EMAIL_SMTP_SECURE: "true", EMAIL_SMTP_USER: SMTP_SECRETS.user, EMAIL_SMTP_PASSWORD: SMTP_SECRETS.password
};

function nodemailerError(message, fields) {
    return Object.assign(new Error(message), fields);
}

function gmailAuthError() {
    const response = `535-5.7.8 Username and Password not accepted for ${SMTP_SECRETS.user}. For more information, go to\n535 5.7.8  ${SMTP_SECRETS.helpUrl} ${SMTP_SECRETS.requestId} - gsmtp`;
    return nodemailerError(`Invalid login: ${response}`, { code: "EAUTH", command: "AUTH PLAIN", responseCode: 535, response });
}

// Reúne todo lo que un operador o un registro podría ver de un error.
function visibleText(error) {
    return [String(error), error?.message, error?.stack, JSON.stringify(error), JSON.stringify(error?.diagnostic), util.inspect(error, { depth: 5 }),
        error?.diagnostic ? describeSmtpDiagnostic(error.diagnostic) : ""].join("\n");
}

function assertNoSmtpSecrets(text) {
    for (const [name, secret] of Object.entries(SMTP_SECRETS)) {
        assert.equal(String(text).includes(secret), false, `se filtró ${name}`);
    }
    assert.doesNotMatch(String(text), /Username and Password not accepted|gsmtp|https?:\/\//, "se filtró la respuesta SMTP original");
}

async function withMockedTransport(transport, fn) {
    const original = nodemailer.createTransport;
    nodemailer.createTransport = () => transport;
    try {
        return await withEnv(SMTP_ENV, fn);
    } finally {
        nodemailer.createTransport = original;
    }
}

test("el detector de filtraciones falla ante un secreto o la respuesta SMTP original", () => {
    for (const leak of Object.values(SMTP_SECRETS)) {
        assert.throws(() => assertNoSmtpSecrets(`diagnóstico ${leak}`), /se filtró/);
    }
    assert.throws(() => assertNoSmtpSecrets(gmailAuthError().response), /se filtró/);
    assert.doesNotThrow(() => assertNoSmtpSecrets(describeSmtpDiagnostic(smtpDiagnostic(gmailAuthError()))));
});

test("el diagnóstico de autenticación conserva solo etapa, códigos y clave de ayuda", () => {
    const diagnostic = smtpDiagnostic(gmailAuthError());
    assert.deepEqual({ ...diagnostic }, {
        code: "EAUTH", originalCode: null, command: "AUTH PLAIN", stage: "autenticación",
        responseCode: 535, enhancedCode: "5.7.8", helpKey: "BadCredentials"
    });
    assert.ok(Object.isFrozen(diagnostic));
    const text = describeSmtpDiagnostic(diagnostic);
    assert.match(text, /^etapa: autenticación \(AUTH PLAIN\) \| código: EAUTH \| código SMTP: 535 \| código extendido: 5\.7\.8 \| ayuda de Gmail: BadCredentials\. /);
    assert.match(text, /Gmail rechazó la cuenta o la contraseña de aplicación/);
    assertNoSmtpSecrets(text);
});

test("el diagnóstico de conexión informa la etapa y el código del sistema en español", () => {
    const timeout = smtpDiagnostic(nodemailerError("Greeting never received", { code: "ETIMEDOUT", command: "CONN" }));
    assert.equal(timeout.stage, "conexión con el servidor");
    assert.equal(timeout.responseCode, null);
    assert.match(describeSmtpDiagnostic(timeout), /etapa: conexión con el servidor \(CONN\) \| código: ETIMEDOUT .*no respondió a tiempo/);

    const refused = smtpDiagnostic(nodemailerError("connect ECONNREFUSED 10.0.0.5:465", { code: "ESOCKET", originalCode: "ECONNREFUSED", command: "CONN" }));
    assert.equal(refused.code, "ESOCKET");
    assert.equal(refused.originalCode, "ECONNREFUSED");
    assert.match(describeSmtpDiagnostic(refused), /código: ESOCKET \/ ECONNREFUSED .*Se interrumpió la conexión/);
    assert.doesNotMatch(describeSmtpDiagnostic(refused), /10\.0\.0\.5/);

    const tlsError = smtpDiagnostic(nodemailerError("self-signed certificate in certificate chain", { code: "ESOCKET", originalCode: "SELF_SIGNED_CERT_IN_CHAIN", command: "CONN" }));
    assert.match(describeSmtpDiagnostic(tlsError), /Falló la conexión cifrada TLS/);

    const dns = smtpDiagnostic(nodemailerError("getaddrinfo ENOTFOUND smtp.example.invalid", { code: "EDNS", originalCode: "ENOTFOUND", command: "CONN" }));
    assert.match(describeSmtpDiagnostic(dns), /No se pudo resolver el nombre del servidor SMTP/);
});

test("las respuestas específicas de Gmail producen indicaciones en español", () => {
    const appPasswordRequired = smtpDiagnostic(nodemailerError("Invalid login", {
        code: "EAUTH", command: "AUTH PLAIN", responseCode: 534,
        response: "534-5.7.9 Application-specific password required. Learn more at\n534 5.7.9  https://support.google.com/mail/?p=InvalidSecondFactor abc - gsmtp"
    }));
    assert.equal(appPasswordRequired.enhancedCode, "5.7.9");
    assert.match(describeSmtpDiagnostic(appPasswordRequired), /exige una contraseña de aplicación/);

    const webLogin = smtpDiagnostic(nodemailerError("Invalid login", {
        code: "EAUTH", command: "AUTH LOGIN", responseCode: 534,
        response: "534-5.7.14 <https://accounts.google.com/signin/continue?sarp=1&scc=1&plt=AKgnsbt> Please log in via your web browser\n534 5.7.14 https://support.google.com/mail/answer/78754 xyz - gsmtp"
    }));
    assert.equal(webLogin.enhancedCode, "5.7.14");
    assert.match(describeSmtpDiagnostic(webLogin), /bloqueó el inicio de sesión/);
    assert.doesNotMatch(describeSmtpDiagnostic(webLogin), /AKgnsbt|accounts\.google/);
});

test("el diagnóstico descarta etapas, códigos y valores con formato no permitido", () => {
    const diagnostic = smtpDiagnostic(nodemailerError("x", {
        code: `EAUTH ${SMTP_SECRETS.password}`,
        originalCode: SMTP_SECRETS.authBase64,
        command: `AUTH PLAIN ${SMTP_SECRETS.authBase64}`,
        responseCode: 999,
        response: `250 ${SMTP_SECRETS.authBase64}`
    }));
    assert.deepEqual({ ...diagnostic }, {
        code: null, originalCode: null, command: null, stage: "desconocida", responseCode: null, enhancedCode: null, helpKey: null
    });
    assert.match(describeSmtpDiagnostic(diagnostic), /Error SMTP no clasificado/);
    assertNoSmtpSecrets(JSON.stringify(diagnostic) + describeSmtpDiagnostic(diagnostic));
    assert.deepEqual({ ...smtpDiagnostic(undefined) }, { ...smtpDiagnostic({}) });
    assert.equal(describeSmtpDiagnostic(undefined), "Sin diagnóstico SMTP disponible.");
});

test("verifySmtpTransport conserva el diagnóstico depurado y no expone credenciales", async () => {
    let closed = false;
    await withMockedTransport({ verify: async () => { throw gmailAuthError(); }, close() { closed = true; } }, async () => {
        const error = await verifySmtpTransport().then(() => null, value => value);
        assert.ok(error instanceof EmailTransportError);
        assert.equal(error.message, "No se pudo verificar la conexión SMTP. Revisa servidor, puerto, usuario y contraseña de aplicación.");
        assert.equal(error.code, undefined, "sin code: el bootstrap no debe presentarlo como error MySQL");
        assert.equal(error.cause, undefined, "el error original no debe viajar adjunto");
        assert.equal(error.diagnostic.code, "EAUTH");
        assert.equal(error.diagnostic.stage, "autenticación");
        assert.equal(error.diagnostic.responseCode, 535);
        assert.equal(error.diagnostic.enhancedCode, "5.7.8");
        assertNoSmtpSecrets(visibleText(error));
    });
    assert.equal(closed, true);
});

test("sendSmtp conserva el diagnóstico de la etapa de envío y mantiene el envío correcto", async () => {
    const recipientError = nodemailerError("Can not send mail - all recipients were rejected", {
        code: "EENVELOPE", command: "RCPT TO", responseCode: 550,
        response: `550-5.1.1 The email account that you tried to reach does not exist ${SMTP_SECRETS.user} ${SMTP_SECRETS.requestId} - gsmtp`
    });
    await withMockedTransport({ sendMail: async () => { throw recipientError; }, close() {} }, async () => {
        const error = await sendSmtp("person@example.invalid", "Asunto", "Cuerpo").then(() => null, value => value);
        assert.ok(error instanceof EmailTransportError);
        assert.equal(error.message, "No se pudo entregar el correo por SMTP.");
        assert.deepEqual({ ...error.diagnostic }, {
            code: "EENVELOPE", originalCode: null, command: "RCPT TO", stage: "destinatario",
            responseCode: 550, enhancedCode: "5.1.1", helpKey: null
        });
        assert.match(describeSmtpDiagnostic(error.diagnostic), /rechazó el remitente o el destinatario/);
        assertNoSmtpSecrets(visibleText(error));
        await assert.rejects(deliverEmail("person@example.invalid", "Asunto", "Cuerpo"), error => error instanceof EmailTransportError && error.diagnostic.stage === "destinatario");
    });
    const sent = [];
    await withMockedTransport({ sendMail: async message => { sent.push(message); }, close() {} }, async () => {
        await deliverEmail("person@example.invalid", "Asunto", "Cuerpo");
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "person@example.invalid");
});

test("el bootstrap describe la contraseña recibida y el fallo SMTP sin revelar secretos", () => {
    const { describeAppPasswordInput, reportSmtpFailure } = require("../scripts/bootstrap-local-primary-admin");
    const valid = describeAppPasswordInput(SMTP_SECRETS.password, 0);
    assert.equal(valid.expectedFormat, true);
    assert.match(valid.text, /^Contraseña de aplicación recibida: 16 caracteres; formato de Google \(16 letras minúsculas\): sí; caracteres de control descartados: 0\.$/);
    assert.equal(valid.text.includes(SMTP_SECRETS.password), false);

    const truncated = describeAppPasswordInput("abcdwxyz", 1);
    assert.equal(truncated.expectedFormat, false);
    assert.match(truncated.text, /8 caracteres; formato de Google \(16 letras minúsculas\): no; caracteres de control descartados: 1\./);
    assert.match(truncated.text, /pega con clic derecho o escribe la contraseña a mano/);
    assert.equal(truncated.text.includes("abcdwxyz"), false);
    assert.equal(describeAppPasswordInput("", 0).expectedFormat, false);

    const written = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = chunk => { written.push(String(chunk)); return true; };
    try {
        reportSmtpFailure(new EmailTransportError("x", smtpDiagnostic(gmailAuthError())), "Gmail no aceptó la verificación SMTP.");
    } finally {
        process.stderr.write = originalWrite;
    }
    const output = written.join("");
    assert.match(output, /^Gmail no aceptó la verificación SMTP\.\nDiagnóstico SMTP: etapa: autenticación \(AUTH PLAIN\) \| código: EAUTH \| código SMTP: 535 \| código extendido: 5\.7\.8/);
    assertNoSmtpSecrets(output);
});
