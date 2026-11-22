"use strict";

// Prueba estática (sin MySQL) de la limpieza de tests/integration.test.js.
// Motivo: el 2026-11-22 la limpieza falló por una FK no cubierta (admin_account_audit,
// añadida con la decisión D2), dejó fixtures en piar_test y el proceso quedó colgado.
// Las relaciones hijo>padre provienen del esquema real de piar_test (información de
// information_schema, migraciones 000–015).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "integration.test.js"), "utf8");
const cleanup = source.slice(source.indexOf("async function cleanupFixture"), source.indexOf("await db.commit();", source.indexOf("async function cleanupFixture")));

const SCHEMA_FKS = [
    "admin_account_audit>usuario", "diagnostico>estudiante", "diagnostico>piar", "diagnostico>psicologa", "diagnostico>usuario",
    "docente>usuario", "estudiante>usuario", "external_identity>usuario", "historial>piar", "historial>usuario",
    "historial_detalle>historial", "historial_detalle>usuario", "observacion>docente", "observacion>estudiante", "observacion>piar",
    "observacion>usuario", "oidc_login_transaction>usuario", "piar>estudiante", "piar>usuario", "piar_ajuste>piar",
    "piar_ajuste>piar_barrera", "piar_ajuste>usuario", "piar_ajuste_evidencia>piar_ajuste", "piar_ajuste_evidencia>usuario",
    "piar_barrera>piar", "piar_barrera>usuario", "piar_docente>docente", "piar_docente>piar", "piar_dua>piar", "piar_dua>usuario",
    "recuperacion_contrasena>usuario", "reporte>estudiante", "reporte>piar", "reporte>usuario", "seguimiento>coordinador",
    "seguimiento>estudiante", "seguimiento>piar", "seguimiento>piar_ajuste", "seguimiento>usuario", "sesion_usuario>usuario",
    "verificacion_correo>usuario"
].map(pair => pair.split(">"));

// Secuencia de tablas borradas, en orden de aparición.
function deletionSequence() {
    const pattern = /deleteIds\("(\w+)"|DELETE (?:\w+ )?FROM (\w+)/g;
    return [...cleanup.matchAll(pattern)].map(match => match[1] || match[2]);
}

test("limpieza de la integración: toda tabla hija de una tabla limpiada también se limpia", () => {
    const cleaned = new Set(deletionSequence());
    for (const table of ["usuario", "estudiante", "docente", "piar"]) assert.ok(cleaned.has(table), table);
    const missing = SCHEMA_FKS.filter(([child, parent]) => cleaned.has(parent) && !cleaned.has(child)).map(pair => pair.join(">"));
    assert.deepEqual(missing, [], "Hijos sin limpiar bloquearían el borrado del padre por FK");
});

test("limpieza de la integración: cada hija se borra antes del borrado final de su padre", () => {
    const sequence = deletionSequence();
    const firstIndex = table => sequence.indexOf(table);
    const lastIndex = table => sequence.lastIndexOf(table);
    const violations = SCHEMA_FKS.filter(([child, parent]) => sequence.includes(child) && sequence.includes(parent) && firstIndex(child) > lastIndex(parent))
        .map(pair => pair.join(">"));
    assert.deepEqual(violations, []);
    // Casos que fallaron o pueden fallar en la práctica.
    assert.ok(firstIndex("admin_account_audit") < lastIndex("usuario"));
    assert.ok(firstIndex("seguimiento") < lastIndex("piar_ajuste"));
    assert.ok(firstIndex("piar_ajuste_evidencia") < lastIndex("piar_ajuste"));
    assert.ok(firstIndex("historial_detalle") < lastIndex("historial"));
    assert.ok(firstIndex("piar_dua") < lastIndex("piar"));
    // Migración 016 (D1): cambio_correo referencia dos veces a usuario y solo existe tras aplicarla.
    assert.ok(firstIndex("cambio_correo") >= 0 && firstIndex("cambio_correo") < lastIndex("usuario"));
    assert.match(cleanup, /TABLE_NAME = 'cambio_correo'[\s\S]*?if \(emailChangeTable\.length\) \{\s*await deleteIds\("cambio_correo", "id_usuario", userIds\);\s*await deleteIds\("cambio_correo", "solicitado_por", userIds\);/);
});

test("limpieza de la integración: transaccional, auditoría atribuible y cierre de recursos ante fallos", () => {
    assert.match(cleanup, /await db\.beginTransaction\(\);/);
    assert.match(source, /await db\.commit\(\);\s*\} catch \(error\) \{\s*await db\.rollback\(\);\s*throw error;/);
    // Eventos de seguridad: solo los atribuibles a la ejecución (usuario sintético o hash de sus correos).
    assert.match(cleanup, /deleteIds\("evento_seguridad", "id_usuario", userIds\)/);
    assert.match(cleanup, /deleteIds\("evento_seguridad", "correo_hash", syntheticEmailHashes\)/);
    assert.doesNotMatch(cleanup, /DELETE FROM evento_seguridad WHERE (?!.*IN)/);
    // El servidor de correo simulado se cierra aunque la limpieza lance un error.
    assert.match(source, /\} finally \{\s*if \(mailServer\?\.listening\) await new Promise\(resolve => mailServer\.close\(resolve\)\);\s*\}/);
    // Destino exclusivo: preflight de identidad, permisos y ausencia de fixtures retenidos antes de escribir.
    for (const guard of ["assertTestEnvironment()", "assertSafeDatabaseIdentityAndGrants(db)", "assertNoRetainedSyntheticFixtureUsers(db)"]) {
        assert.ok(source.includes(guard), guard);
    }
});
