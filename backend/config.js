const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env");

try {
    // Tests must use their explicit isolated environment and never inspect local secrets.
    const contents = process.env.NODE_ENV === "test" ? "" : fs.readFileSync(envPath, "utf8");

    for (const line of contents.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("#")) {
            continue;
        }

        const separator = trimmedLine.indexOf("=");
        if (separator < 1) {
            continue;
        }

        const key = trimmedLine.slice(0, separator).trim();
        const value = trimmedLine.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
} catch (error) {
    if (error.code !== "ENOENT") {
        throw error;
    }
}

module.exports = process.env;
