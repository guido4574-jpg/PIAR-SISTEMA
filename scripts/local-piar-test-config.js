"use strict";

const TARGET = Object.freeze({
    host: "127.0.0.1",
    port: 3307,
    user: "piar_test",
    database: "piar_test",
    apiPort: "8081"
});

const TARGETS = Object.freeze({
    existing: TARGET,
    fresh: Object.freeze({ ...TARGET, port: 3308 })
});

function targetForProfile(profile = "existing", env = process.env) {
    if (profile === "ensayo") {
        // Copia desechable de piar_test en el mismo MySQL local, con su propia cuenta DML.
        // Así la integración nunca escribe en piar_test.
        const database = String(env.PIAR_TEST_DB_NAME || "");
        const user = String(env.PIAR_TEST_DB_USER || "");
        if (!/^piar_test_ensayo_[a-z0-9_]+$/.test(database)) throw new Error("PIAR_TEST_DB_NAME debe ser un esquema piar_test_ensayo_*.");
        if (!/^piar_ensayo_[a-z0-9_]+$/.test(user)) throw new Error("PIAR_TEST_DB_USER debe ser una cuenta piar_ensayo_*.");
        const port = Number(env.PIAR_TEST_DB_PORT || TARGET.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PIAR_TEST_DB_PORT must be a valid TCP port.");
        return Object.freeze({ ...TARGET, port, database, user });
    }
    if (profile === "local") {
        // Any MySQL on loopback exposing piar_test. Defaults to the single local
        // container (piar-mysql-test, 3307), never to 3306 where the native
        // service may host the institutional database. CI sets the port explicitly.
        const port = Number(env.PIAR_TEST_DB_PORT || TARGET.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PIAR_TEST_DB_PORT must be a valid TCP port.");
        return Object.freeze({ ...TARGET, port });
    }
    if (!Object.hasOwn(TARGETS, profile)) {
        throw new Error("Integration target must be explicitly selected as existing or fresh.");
    }
    return TARGETS[profile];
}

function mysqlConnectionConfig(password, profile = "existing") {
    if (typeof password !== "string" || password.length === 0) {
        throw new Error("A non-empty local test database password is required.");
    }
    const target = targetForProfile(profile);
    return {
        host: target.host,
        port: target.port,
        user: target.user,
        password,
        database: target.database,
        connectTimeout: 5000
    };
}

function integrationEnvironment(base, password, profile = "existing") {
    if (typeof password !== "string" || password.length === 0) {
        throw new Error("A non-empty local test database password is required.");
    }
    const target = targetForProfile(profile);
    return {
        ...base,
        DB_HOST: target.host,
        DB_PORT: String(target.port),
        DB_NAME: target.database,
        DB_USER: target.user,
        DB_PASSWORD: password,
        PIAR_TEST_PROFILE: profile,
        HOST: "127.0.0.1",
        PORT: TARGET.apiPort,
        NODE_ENV: "test",
        APP_BASE_URL: `http://127.0.0.1:${TARGET.apiPort}`,
        EMAIL_TRANSPORT: "api"
    };
}

function assertIntegrationGrants(grantRows, database = "piar_test") {
    const expectedScope = `${String(database).toUpperCase()}.*`;
    const required = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    const granted = new Set();
    const rows = Array.isArray(grantRows) ? grantRows : [];
    if (!rows.length) throw new Error("MySQL SHOW GRANTS returned no grants.");

    for (const row of rows) {
        const value = typeof row === "string" ? row : Object.values(row || {})[0];
        const normalized = String(value || "").replace(/\\_/g, "_").replace(/`/g, "").replace(/\s+/g, " ").trim().toUpperCase();
        if (/\bWITH GRANT OPTION\b/.test(normalized)) {
            throw new Error("The integration database account must not have GRANT OPTION.");
        }
        const match = normalized.match(/^GRANT (.+?) ON (.+?) TO /);
        if (!match) throw new Error("The integration database account has an unsupported grant.");
        const privileges = new Set(match[1].split(",").map(value => value.trim()));
        const scope = match[2].replace(/\s+/g, "");

        if (scope === "*.*" && privileges.size === 1 && privileges.has("USAGE")) continue;
        if (scope !== expectedScope) {
            throw new Error(`The integration database account has privileges outside ${database}.*.`);
        }
        for (const privilege of privileges) {
            if (!required.has(privilege)) {
                throw new Error("The integration database account has privileges beyond SELECT/INSERT/UPDATE/DELETE.");
            }
            granted.add(privilege);
        }
    }

    const missing = [...required].filter(privilege => !granted.has(privilege));
    if (missing.length) throw new Error(`The integration database account is missing required privileges: ${missing.join(", ")}.`);
    return true;
}

function assertFixtureRetentionDisabled(env = process.env) {
    if (env.PIAR_TEST_KEEP_FIXTURES === "1") {
        throw new Error("PIAR_TEST_KEEP_FIXTURES ya no está permitido: la integración limpia solo sus fixtures y falla ante restos previos.");
    }
    return true;
}

module.exports = { TARGET, targetForProfile, mysqlConnectionConfig, integrationEnvironment, assertIntegrationGrants, assertFixtureRetentionDisabled };
