"use strict";

// Aviso por correo de la decisión sobre una solicitud de cuenta (aprobación o
// rechazo). Se envía después de confirmar la transacción: si el correo falla,
// la decisión se mantiene y el Administrador recibe el aviso de no entrega.
// El motivo del rechazo no se incluye: puede contener notas internas.
const { deliverEmail } = require("./email");

const ROLE_LABELS = Object.freeze({ "Psicóloga": "Psicólogo(a)" });

function decisionMessage(decision, { nombre, rol }, baseUrl) {
    const role = ROLE_LABELS[rol] || rol;
    const greeting = nombre ? `Hola, ${nombre}:` : "Hola:";
    if (decision === "aprobar") {
        return {
            subject: "PIAR: tu cuenta fue aprobada",
            text: `${greeting}\n\nLa institución aprobó tu cuenta con el perfil ${role}. Ya puedes iniciar sesión en ${baseUrl}.\n\nSi no solicitaste esta cuenta, comunícate con la institución.`
        };
    }
    return {
        subject: "PIAR: tu solicitud de cuenta no fue aprobada",
        text: `${greeting}\n\nLa institución revisó tu solicitud de cuenta con el perfil ${role} y no fue aprobada. Para más información, comunícate con la institución.`
    };
}

async function notifyRegistrationDecision(decision, user, { baseUrl, deliver = deliverEmail } = {}) {
    if (!user?.correo || !["aprobar", "rechazar"].includes(decision)) return "no_enviada";
    const { subject, text } = decisionMessage(decision, user, baseUrl || "");
    try {
        await deliver(user.correo, subject, text);
        return "enviada";
    } catch {
        console.error("No se pudo enviar el aviso de decisión de la solicitud.");
        return "no_enviada";
    }
}

module.exports = { notifyRegistrationDecision, decisionMessage };
