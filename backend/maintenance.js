"use strict";

// Periodic purge of expired credentials and counters. Rows are deleted in
// small batches so the cleanup never holds long locks on hot tables.
const BATCH_SIZE = 1000;
const MAX_BATCHES = 50;

function purgeStatements(retentionDays) {
    return [
        { table: "sesion_usuario", sql: "DELETE FROM sesion_usuario WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY OR revoked_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY LIMIT ?" },
        { table: "recuperacion_contrasena", sql: "DELETE FROM recuperacion_contrasena WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY OR consumed_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY LIMIT ?" },
        { table: "verificacion_correo", sql: "DELETE FROM verificacion_correo WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY OR consumed_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY LIMIT ?" },
        // Migración 016; si aún no existe, la purga la marca como "tabla ausente".
        { table: "cambio_correo", sql: "DELETE FROM cambio_correo WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY OR consumed_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY LIMIT ?" },
        { table: "oidc_login_transaction", sql: "DELETE FROM oidc_login_transaction WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL 1 DAY LIMIT ?" },
        { table: "limite_solicitudes", sql: "DELETE FROM limite_solicitudes WHERE expira_at < NOW(3) LIMIT ?" },
        { table: "evento_seguridad", sql: `DELETE FROM evento_seguridad WHERE created_at < CURRENT_TIMESTAMP - INTERVAL ${retentionDays} DAY LIMIT ?` }
    ];
}

function retentionDaysFrom(env) {
    const days = Number(env.SECURITY_EVENT_RETENTION_DAYS || 365);
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
        throw new Error("SECURITY_EVENT_RETENTION_DAYS debe ser un entero entre 30 y 3650.");
    }
    return days;
}

async function purgeExpiredRecords(db, { env = process.env } = {}) {
    const summary = {};
    for (const { table, sql } of purgeStatements(retentionDaysFrom(env))) {
        let deleted = 0;
        try {
            for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
                const [result] = await db.promise().query(sql, [BATCH_SIZE]);
                deleted += Number(result.affectedRows || 0);
                if (Number(result.affectedRows || 0) < BATCH_SIZE) break;
            }
            summary[table] = deleted;
        } catch (error) {
            // A table from a pending migration must not stop the other purges.
            summary[table] = error.code === "ER_NO_SUCH_TABLE" ? "tabla ausente" : `error ${error.code || error.name}`;
        }
    }
    return summary;
}

function scheduleMaintenance(db, { env = process.env, logger = console } = {}) {
    const minutes = Number(env.MAINTENANCE_INTERVAL_MINUTES ?? 60);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    const run = () => purgeExpiredRecords(db, { env })
        .then(summary => {
            const failures = Object.entries(summary).filter(([, value]) => typeof value === "string" && value.startsWith("error"));
            if (failures.length) logger.error(`Mantenimiento con errores: ${failures.map(([table, value]) => `${table}=${value}`).join(", ")}`);
        })
        .catch(error => logger.error(`Mantenimiento no ejecutado (${error.code || error.name || "ERROR"}).`));
    const first = setTimeout(run, 60 * 1000);
    const timer = setInterval(run, minutes * 60 * 1000);
    first.unref();
    timer.unref();
    return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { purgeExpiredRecords, scheduleMaintenance, retentionDaysFrom };
