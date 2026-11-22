"use strict";

const SYNTHETIC_FIXTURE_DOCUMENT = /^IT[0-9A-F]{16}([0-6]|R|X)$/i;

function isRetainedSyntheticFixtureUser(row) {
    if (!row) return false;
    const email = String(row.correo || "").trim();
    const document = String(row.documento || "").trim();
    if (!SYNTHETIC_FIXTURE_DOCUMENT.test(document)) return false;
    return email.toLowerCase() === `${document.toLowerCase()}@example.invalid`;
}

function hasRetainedSyntheticFixtureUsers(rows) {
    return rows.some(isRetainedSyntheticFixtureUser);
}

async function assertNoRetainedSyntheticFixtureUsers(connection) {
    const [rows] = await connection.execute(
        "SELECT rol, correo, documento FROM usuario WHERE UPPER(documento) REGEXP ? AND LOWER(correo) = CONCAT(LOWER(documento), '@example.invalid') LIMIT 1",
        ["^IT[0-9A-F]{16}([0-6]|R|X)$"]
    );
    if (hasRetainedSyntheticFixtureUsers(rows)) {
        throw new Error("Preflight detenido: existen fixtures de integración retenidos. No se crearon fixtures nuevos ni se modificaron restos anteriores.");
    }
}

module.exports = { isRetainedSyntheticFixtureUser, hasRetainedSyntheticFixtureUsers, assertNoRetainedSyntheticFixtureUsers };
