const fs = require("fs/promises");
const path = require("path");
require("./config");

const mysql = require("mysql2/promise");

const migrationFile = process.argv[2];

if (!migrationFile) {
    console.error("Uso: node backend/run-migration.js <archivo-sql>");
    process.exit(1);
}

const connectionConfig = {
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "piar",
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: false
};

async function main() {
    const filePath = path.resolve(process.cwd(), migrationFile);
    const sql = await fs.readFile(filePath, "utf8");
    const statements = splitSqlStatements(sql);

    if (!statements.length) {
        throw new Error(`El archivo ${migrationFile} no contiene sentencias SQL ejecutables.`);
    }

    const connection = await mysql.createConnection(connectionConfig);

    try {
        for (const statement of statements) {
            await connection.query(statement);
        }

        console.log(`Migracion aplicada correctamente: ${migrationFile}`);
        console.log(`Base de datos: ${connectionConfig.database}`);
    } finally {
        await connection.end();
    }
}

function splitSqlStatements(sql) {
    const statements = [];
    let current = "";
    let quote = null;
    let escaped = false;
    let lineComment = false;

    for (let index = 0; index < sql.length; index += 1) {
        const char = sql[index];
        const next = sql[index + 1];

        if (lineComment) {
            if (char === "\n") {
                lineComment = false;
                current += char;
            }
            continue;
        }

        if (!quote && char === "-" && next === "-") {
            lineComment = true;
            index += 1;
            continue;
        }

        current += char;

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }

        if (char === ";") {
            const statement = current.slice(0, -1).trim();
            if (statement) {
                statements.push(statement);
            }
            current = "";
        }
    }

    const tail = current.trim();
    if (tail) {
        statements.push(tail);
    }

    return statements;
}

main().catch(error => {
    console.error("No se pudo aplicar la migracion:", error.message);
    process.exit(1);
});
