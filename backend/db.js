require("./config");

const mysql = require("mysql2");
const { buildDatabaseConfig } = require("./database-config");
const config = buildDatabaseConfig(process.env);
if (config.database.toLowerCase() === "piar") {
    throw new Error("El esquema 'piar' está bloqueado por seguridad; configure una base local con un nombre explícito y aislado.");
}

const db = mysql.createPool({
    host: config.host,
    user: config.user,
    password: config.password,
    database: config.database,
    port: config.port,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    ...(config.ssl ? { ssl: config.ssl } : {})
});

db.query("SELECT 1", (error) => {
    if (error) {
        console.error("Error de conexión a MySQL:", error.code || error.name || "ERROR");
        return;
    }

    console.log("Conectado a MySQL");
});

module.exports = db;
