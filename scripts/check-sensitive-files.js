"use strict";

// Guard against committing personal data or secrets (npm run check:secrets).
// Revisa los archivos versionados y los no versionados que Git agregaría (no
// ignorados), para que un `git add` general no incorpore secretos. Solo informa
// la ruta y la regla, nunca el valor encontrado.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_PATHS = [
    [/^data\/.*\.(json|sqlite3?|csv)$/i, "datos locales en data/"],
    [/(^|\/)\.env(\.[^/]+)?$/, "archivo de entorno"],
    [/\.(pem|key|p8|p12|pfx)$/i, "clave privada o certificado"],
    [/cookies?(\.[a-z]+)?\.txt$/i, "cookies de sesión"],
    [/\.(sqlite3?|sql\.gz|dump)$/i, "volcado de base de datos"],
    [/(^|\/)(respaldo|backup|transferencia|admin-row)[^/]*\.(sql|tsv|json)$/i, "respaldo o exportación de datos"]
];
const ALLOWED_PATHS = new Set([".env.example", ".env.test.example"]);

const CONTENT_RULES = [
    // A literal demo credential value (placeholders such as "<retirada>" or @ejemplo are allowed).
    [/\bvalid(Email|Password)\s*:\s*["'](?!<|[^"']*@ejemplo\.)[^"']+["']/, "credencial de demostración embebida"],
    [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, "clave privada"],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "token de GitHub"],
    [/\bAKIA[0-9A-Z]{16}\b/, "clave de AWS"],
    [/^\s*(DB_PASSWORD|MIGRATION_DB_PASSWORD|EMAIL_SMTP_PASSWORD|RESEND_API_KEY|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_SECRET|APPLE_PRIVATE_KEY|PASSWORD_RESET_DELIVERY_SECRET|EMAIL_DEV_OUTBOX_SECRET)=(?!$|REPLACE_|<|\$\{\{)[^\s#]+/m, "secreto con valor en plantilla de entorno"],
    // Las referencias de Railway (${{Servicio.VARIABLE}}) no son secretos: se resuelven en el panel.
    // Clave de API de Resend (re_ seguido de un valor aleatorio con dígitos y mayúsculas).
    [/\bre_(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{20,}\b/, "clave de API de Resend"],
    // Correos de proveedores personales: datos personales reales. Los ejemplos usan dominios .invalid o example.
    [/\b[A-Za-z0-9._%+-]+@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud)\.[a-z.]{2,6}\b/i, "correo personal"],
    // A bcrypt hash outside the documented timing dummy (exported account rows, dumps).
    [/\$2[aby]\$\d{2}\$(?!5uZIhcxBiA\/lm3D1ieXfOOZS)[./A-Za-z0-9]{53}/, "hash de contraseña"]
];
const SKIP_CONTENT = [/^node_modules\//, /^package-lock\.json$/, /\.(png|jpe?g|gif|ico|pdf|woff2?)$/i, /^scripts\/check-sensitive-files\.js$/, /^tests\/security-guard\.test\.js$/];

function gitList(args) {
    return execFileSync("git", ["ls-files", "-z", ...args], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}

// Archivos versionados más los no versionados que Git agregaría (no ignorados).
function candidateFiles() {
    return [...new Set([...gitList([]), ...gitList(["--others", "--exclude-standard"])])]
        .filter(file => fs.existsSync(path.join(ROOT, file)));
}

function findViolations(files, readFile = file => fs.readFileSync(path.join(ROOT, file), "utf8")) {
    const violations = [];
    for (const file of files) {
        const forbidden = !ALLOWED_PATHS.has(file) && FORBIDDEN_PATHS.find(([pattern]) => pattern.test(file));
        if (forbidden) violations.push({ file, rule: forbidden[1] });
        if (SKIP_CONTENT.some(pattern => pattern.test(file))) continue;
        let content;
        try { content = readFile(file); } catch { continue; }
        for (const [pattern, rule] of CONTENT_RULES) {
            if (pattern.test(content)) violations.push({ file, rule });
        }
    }
    return violations;
}

if (require.main === module) {
    const files = candidateFiles();
    const violations = findViolations(files);
    if (violations.length) {
        console.error("Se detectó información sensible en archivos versionados o pendientes de agregar:");
        for (const { file, rule } of violations) console.error(`  ${file}: ${rule}`);
        process.exitCode = 1;
    } else {
        console.log(`Sin datos personales ni secretos detectados en ${files.length} archivos (versionados y pendientes de agregar).`);
    }
}

module.exports = { findViolations, candidateFiles, FORBIDDEN_PATHS, CONTENT_RULES };
