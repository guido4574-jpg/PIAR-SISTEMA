"use strict";

// One-off purge of expired sessions, tokens, OIDC transactions, rate-limit
// counters and security events past retention. The server already runs the
// same purge periodically (MAINTENANCE_INTERVAL_MINUTES); this script is for
// operators and scheduled jobs. Uses the DB_* configuration of the backend.
require("../backend/config");

const db = require("../backend/db");
const { purgeExpiredRecords } = require("../backend/maintenance");

purgeExpiredRecords(db)
    .then(summary => {
        for (const [table, result] of Object.entries(summary)) console.log(`${table}: ${result}`);
    })
    .catch(error => {
        console.error(`Purga no completada (${error.code || error.name || "ERROR"}).`);
        process.exitCode = 1;
    })
    .finally(() => db.end());
