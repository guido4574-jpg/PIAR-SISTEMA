"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { INSTITUTION } = require("../backend/institution-config");

const appSource = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
const dataSource = fs.readFileSync(path.join(__dirname, "../public/js/data.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");

test("the single institution is configured centrally without invented location data", () => {
    assert.deepEqual(INSTITUTION, { name: "Colegio Reinaldo Matiz" });
    assert.match(dataSource, /name: "Colegio Reinaldo Matiz"/);
    assert.match(serverSource, /url\.pathname === "\/api\/config"[\s\S]*?institution: INSTITUTION/);
});

test("browser-stored settings cannot override the canonical institution name", () => {
    const sandbox = {
        window: { APP_DATA: { institution: { name: "Colegio Reinaldo Matiz", municipio: "" } } },
        structuredClone,
        document: { addEventListener() {} },
        localStorage: { getItem: () => JSON.stringify({ name: "Colegio inventado", municipio: "" }) }
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox);
    vm.runInContext("state = createInitialState(); loadInstitutionSettings()", sandbox);
    assert.equal(vm.runInContext("state.institution.name", sandbox), "Colegio Reinaldo Matiz");
    assert.match(appSource, /value="\$\{escapeHTML\(state\.institution\.name\)\}" readonly/);
});

test("Rector reviews registrations with limits: Rector-profile requests stay reserved to Administrador", () => {
    const source = fs.readFileSync(path.join(__dirname, "../backend/authorization.js"), "utf8");
    assert.match(source, /approval\) return method === "POST" && includesRole\(\["Administrador", "Rector"\], role\)/);
    const { decidableRoles } = require("../backend/registration-approval");
    assert.deepEqual(decidableRoles("Administrador"), ["Docente", "Psicóloga", "Coordinador", "Rector"]);
    assert.deepEqual(decidableRoles("Rector"), ["Docente", "Psicóloga", "Coordinador"]);
    for (const role of ["Coordinador", "Psicóloga", "Docente", "Estudiante", undefined]) assert.deepEqual(decidableRoles(role), [], String(role));
});
