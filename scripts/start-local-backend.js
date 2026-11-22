"use strict";

// Starts the backend natively on Windows against the local test MySQL container
// (piar-mysql-test, 127.0.0.1:3307). DB_* credentials are read from .env.test and
// passed only as process environment variables: they are never printed and
// neither .env nor .env.test is modified. Other settings still come from .env.
//
//   node scripts/start-local-backend.js                 -> piar_test on http://127.0.0.1:8090
//   PIAR_LOCAL_DB_NAME=piar_test_e2e PORT=8092 node scripts/start-local-backend.js
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DB_KEYS = new Set(["DB_USER", "DB_PASSWORD"]);

function readTestCredentials(file = path.join(ROOT, ".env.test")) {
    const values = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
        if (match && DB_KEYS.has(match[1])) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
    if (!values.DB_USER || !values.DB_PASSWORD) throw new Error(".env.test no define DB_USER/DB_PASSWORD.");
    if (values.DB_USER.toLowerCase() === "root") throw new Error("La aplicación no se ejecuta con root.");
    return values;
}

function buildEnvironment(base = process.env, credentials = readTestCredentials()) {
    const database = base.PIAR_LOCAL_DB_NAME || "piar_test";
    if (!/^piar_test(?:_[a-z0-9_]+)?$/.test(database)) throw new Error("Solo se admite piar_test o un esquema desechable piar_test_*.");
    return {
        ...base,
        ...credentials,
        DB_HOST: "127.0.0.1",
        DB_PORT: "3307",
        DB_NAME: database,
        HOST: "127.0.0.1",
        PORT: base.PORT || "8090"
    };
}

if (require.main === module) {
    try {
        const env = buildEnvironment();
        process.stdout.write(`Backend local -> http://127.0.0.1:${env.PORT} | MySQL 127.0.0.1:3307/${env.DB_NAME}\n`);
        const child = spawn(process.execPath, [path.join(ROOT, "backend", "server.js")], { cwd: ROOT, env, stdio: "inherit" });
        for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
        child.on("exit", code => { process.exitCode = code ?? 1; });
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildEnvironment, readTestCredentials };
