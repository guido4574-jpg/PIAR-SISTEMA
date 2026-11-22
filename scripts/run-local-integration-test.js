"use strict";

const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");
const { promptPassword } = require("./apply-local-password-recovery-migration");
const { integrationEnvironment } = require("./local-piar-test-config");
const { assertFreshTestContainer } = require("./fresh-test-container");

function verifyFreshContainer() {
    let metadata;
    try {
        const output = execFileSync("docker", ["inspect", "piar-mysql-test-fresh"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        metadata = JSON.parse(output);
    } catch {
        throw new Error("No se pudo verificar piar-mysql-test-fresh; inicia únicamente el entorno efímero documentado antes de probar integración.");
    }
    return assertFreshTestContainer(metadata);
}

async function main() {
    const profile = process.argv[2] || "fresh";
    if (process.argv.length > 3 || !["fresh", "local", "ensayo"].includes(profile)) {
        throw new Error("Perfiles admitidos: local (MySQL en 127.0.0.1:PIAR_TEST_DB_PORT) o fresh (contenedor 127.0.0.1:3308); no se conectó a ninguna base.");
    }
    if (profile === "fresh") verifyFreshContainer();
    // PIAR_TEST_DB_PASSWORD allows non-interactive runs (CI); otherwise the password is prompted.
    const password = process.env.PIAR_TEST_DB_PASSWORD || await promptPassword("Password for local piar_test integration (input hidden): ");
    if (!password) throw new Error("An empty password is not accepted; no test was started.");

    const child = spawn(process.execPath, ["--test", "tests/integration.test.js"], {
        env: integrationEnvironment(process.env, password, profile),
        stdio: "inherit",
        windowsHide: true
    });
    child.once("error", error => {
        console.error(`Could not start the local integration test (${error.code || "ERROR"}).`);
        process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
    });
}

if (require.main === module) main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

module.exports = { verifyFreshContainer, main };
