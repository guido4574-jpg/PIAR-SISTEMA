"use strict";

// Prueba controlada del correo de producción (Gmail SMTP u otro transporte persistente).
//   node scripts/probar-correo.js --verificar
//       Conecta y se autentica con el servidor SMTP. No envía nada.
//   node scripts/probar-correo.js --enviar <correo-destino>
//       Envía UN mensaje de prueba. Exige PIAR_CONFIRMAR_ENVIO=SI.
// Lee solo variables de entorno (EMAIL_*); nunca imprime la contraseña ni el contenido del
// mensaje. No lee el .env local: las variables se definen en la sesión de la terminal.
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const { assertPersistentEmailTransport, verifySmtpTransport, deliverEmail, describeSmtpDiagnostic } = require("../backend/email");

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function parseArgs(argv) {
    if (argv[0] === "--verificar" && argv.length === 1) return { mode: "verificar" };
    if (argv[0] === "--enviar" && argv.length === 2 && EMAIL.test(argv[1])) return { mode: "enviar", to: argv[1].trim() };
    throw new Error("Uso: --verificar  o  --enviar <correo-destino>");
}

function configurationSummary(env = process.env) {
    const mode = assertPersistentEmailTransport(env);
    const summary = { transporte: mode, remitente: String(env.EMAIL_FROM || "").trim() };
    if (mode === "smtp") {
        summary.servidor = String(env.EMAIL_SMTP_HOST || "").trim();
        summary.puerto = Number(env.EMAIL_SMTP_PORT || 587);
        summary.tls = String(env.EMAIL_SMTP_SECURE || "false").toLowerCase() === "true" ? "TLS directo (465)" : "STARTTLS (587)";
        summary.usuario = String(env.EMAIL_SMTP_USER || "").trim();
        // Gmail reescribe el remitente si no es la cuenta autenticada ni un alias verificado.
        summary.remitenteIgualAlUsuario = summary.remitente.toLowerCase() === summary.usuario.toLowerCase();
    }
    return summary;
}

function testMessage(now = new Date()) {
    return {
        subject: "PIAR: prueba de envío de correo",
        text: `Este es un mensaje de prueba del sistema PIAR enviado el ${now.toISOString()}. Si lo recibiste, el correo institucional está configurado correctamente. No respondas a este mensaje.`
    };
}

async function main(argv = process.argv.slice(2), env = process.env, deps = { verifySmtpTransport, deliverEmail }) {
    const args = parseArgs(argv);
    const summary = configurationSummary(env);
    console.log(`Configuración: ${JSON.stringify(summary)}`);
    if (summary.transporte === "smtp" && !summary.remitenteIgualAlUsuario) {
        console.warn("Advertencia: EMAIL_FROM no coincide con EMAIL_SMTP_USER; Gmail puede reemplazar el remitente.");
    }
    if (args.mode === "verificar") {
        if (summary.transporte !== "smtp") throw new Error("--verificar solo aplica a EMAIL_TRANSPORT=smtp.");
        await deps.verifySmtpTransport();
        console.log("Conexión y autenticación SMTP correctas. No se envió ningún mensaje.");
        return { verified: true };
    }
    if (String(env.PIAR_CONFIRMAR_ENVIO || "") !== "SI") throw new Error("Para enviar, define PIAR_CONFIRMAR_ENVIO=SI.");
    const { subject, text } = testMessage();
    await deps.deliverEmail(args.to, subject, text);
    console.log("El servidor de correo aceptó el mensaje. Confirma la recepción en la bandeja de destino (revisa también spam).");
    return { sent: true };
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Prueba de correo no superada: ${error.message}`);
        if (error.diagnostic) console.error(describeSmtpDiagnostic(error.diagnostic));
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs, configurationSummary, testMessage };
