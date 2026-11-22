"use strict";

// Prueba controlada del correo de producción (Resend, Gmail SMTP u otro transporte persistente).
//   node scripts/probar-correo.js --verificar
//       SMTP: conecta y se autentica. Resend: comprueba que el dominio de EMAIL_FROM esté
//       verificado (requiere una clave de acceso completo). No envía nada.
//   node scripts/probar-correo.js --enviar <correo-destino>
//       Envía UN mensaje de prueba. Exige PIAR_CONFIRMAR_ENVIO=SI.
// Lee solo variables de entorno (EMAIL_*); nunca imprime la contraseña ni el contenido del
// mensaje. No lee el .env local: las variables se definen en la sesión de la terminal.
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const { assertPersistentEmailTransport, verifySmtpTransport, verifyResendSender, deliverEmail, describeSmtpDiagnostic, RESEND_API_ORIGIN } = require("../backend/email");

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
    if (mode === "resend") {
        // Nunca se muestra la clave: solo si está presente.
        summary.api = String(env.RESEND_API_BASE_URL || RESEND_API_ORIGIN);
        summary.nombreRemitente = String(env.EMAIL_FROM_NAME || "").trim() || "(sin nombre)";
        summary.clave = "configurada";
    }
    return summary;
}

function testMessage(now = new Date()) {
    return {
        subject: "PIAR: prueba de envío de correo",
        text: `Este es un mensaje de prueba del sistema PIAR enviado el ${now.toISOString()}. Si lo recibiste, el correo institucional está configurado correctamente. No respondas a este mensaje.`
    };
}

async function main(argv = process.argv.slice(2), env = process.env, deps = { verifySmtpTransport, verifyResendSender, deliverEmail }) {
    const args = parseArgs(argv);
    const summary = configurationSummary(env);
    console.log(`Configuración: ${JSON.stringify(summary)}`);
    if (summary.transporte === "smtp" && !summary.remitenteIgualAlUsuario) {
        console.warn("Advertencia: EMAIL_FROM no coincide con EMAIL_SMTP_USER; Gmail puede reemplazar el remitente.");
    }
    if (args.mode === "verificar" && summary.transporte === "resend") {
        const result = await deps.verifyResendSender(env);
        if (result.sendsOnlyToAccountOwner) {
            console.warn("Remitente de prueba (resend.dev): solo entrega al correo del dueño de la cuenta de Resend.");
            return { verified: false, ...result };
        }
        if (result.status !== "verified") throw new Error(`El dominio ${result.domain} no está verificado en Resend (estado: ${result.status}).`);
        console.log(`Dominio ${result.domain} verificado en Resend. No se envió ningún mensaje.`);
        return { verified: true, ...result };
    }
    if (args.mode === "verificar") {
        if (summary.transporte !== "smtp") throw new Error("--verificar solo aplica a EMAIL_TRANSPORT=smtp o resend.");
        await deps.verifySmtpTransport();
        console.log("Conexión y autenticación SMTP correctas. No se envió ningún mensaje.");
        return { verified: true };
    }
    if (String(env.PIAR_CONFIRMAR_ENVIO || "") !== "SI") throw new Error("Para enviar, define PIAR_CONFIRMAR_ENVIO=SI.");
    const { subject, text } = testMessage();
    const delivery = await deps.deliverEmail(args.to, subject, text);
    const id = typeof delivery?.id === "string" ? ` Identificador en Resend: ${delivery.id}.` : "";
    console.log(`El servicio de correo aceptó el mensaje.${id} Confirma la recepción en la bandeja de destino (revisa también spam).`);
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
