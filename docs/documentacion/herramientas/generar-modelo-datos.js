"use strict";

// Genera el diccionario de datos (Markdown) y los diagramas entidad-relación (Mermaid) a partir
// de la estructura real de un esquema MySQL creado con las migraciones 000–016.
// Entrada: archivos TSV de information_schema (solo estructura, nunca datos):
//   node generar-modelo-datos.js <carpeta-tsv> <carpeta docs/documentacion>
// Los TSV se obtienen con consultas de solo lectura (ver docs/documentacion/README_DOCUMENTACION.md).
const fs = require("node:fs");
const path = require("node:path");

const [tsvDir, outDir] = process.argv.slice(2);
const readTsv = name => fs.readFileSync(path.join(tsvDir, name), "utf8").split(/\r?\n/).filter(Boolean).map(line => line.split("\t"));

const columns = readTsv("dd-cols.tsv").map(([table, column, type, nullable, def, key, extra, pos]) => ({ table, column, type, nullable, def, key, extra, pos: Number(pos) }));
const fks = readTsv("dd-fks.tsv").map(([table, column, refTable, refColumn, rule, name]) => ({ table, column, refTable, refColumn, rule, name }));
const indexes = readTsv("dd-idx.tsv").map(([table, name, nonUnique, cols]) => ({ table, name, unique: nonUnique === "0", cols }));
const tables = readTsv("dd-tables.tsv").map(([name, engine, collation]) => ({ name, engine, collation }));

// Propósito de cada tabla, redactado a partir de las migraciones y del código que la usa.
const PURPOSE = {
    admin_account_audit: ["Cuentas y seguridad", "Auditoría de operaciones administrativas sobre cuentas: creación, aprobación, rechazo, desactivación, reactivación y cambio de correo (migración 009)."],
    cambio_correo: ["Cuentas y seguridad", "Solicitudes de cambio de correo pendientes de confirmar; guarda solo el hash del token, con vencimiento de 24 h (migración 016, decisión D1)."],
    coordinador: ["Pedagógico", "Perfil de coordinación referenciado por los seguimientos (id_coordinador). No se vincula con usuario."],
    diagnostico: ["Pedagógico", "Diagnósticos asociados a un estudiante y, opcionalmente, a un PIAR; registra el autor (id_usuario_creador)."],
    docente: ["Pedagógico", "Perfil docente; se vincula con la cuenta mediante id_usuario y con los PIAR mediante piar_docente."],
    estudiante: ["Pedagógico", "Registro del estudiante: identificación, caracterización, contexto y, desde la migración 015, la cuenta de acceso vinculada (id_usuario, única)."],
    evento_seguridad: ["Cuentas y seguridad", "Eventos de autenticación y seguridad con el correo en hash y la red de origen truncada (migración 012)."],
    external_identity: ["Cuentas y seguridad", "Identidades de proveedores externos (Google, Microsoft, Apple) vinculadas a una cuenta; único por issuer y subject (migración 003)."],
    historial: ["Pedagógico", "Cabecera de cada versión o evento del historial de un PIAR."],
    historial_detalle: ["Pedagógico", "Detalle de cada cambio versionado: valores anterior y nuevo en JSON, tipo de registro y autor."],
    limite_solicitudes: ["Cuentas y seguridad", "Contadores de límites de intentos compartidos entre instancias cuando RATE_LIMIT_STORE=mysql; la clave es un hash."],
    observacion: ["Pedagógico", "Observaciones pedagógicas del estudiante o del PIAR; inmutables una vez registradas."],
    oidc_login_transaction: ["Cuentas y seguridad", "Transacciones de un solo uso del inicio de sesión externo: state, nonce y verificador PKCE."],
    piar: ["Pedagógico", "Plan Individual de Ajustes Razonables: componentes pedagógicos del Decreto 1421 de 2017, estado y fechas de revisión y cierre."],
    piar_ajuste: ["Pedagógico", "Ajustes razonables del PIAR, con trazabilidad a la barrera (clave compuesta id_piar, id_barrera), responsable, indicador y avance (0–100)."],
    piar_ajuste_evidencia: ["Pedagógico", "Evidencias descriptivas de la aplicación de un ajuste (no almacena archivos)."],
    piar_auditoria: ["Cuentas y seguridad", "Auditoría de acceso a recursos pedagógicos: actor, acción, recurso, resultado y código HTTP, sin contenido (migración 007)."],
    piar_barrera: ["Pedagógico", "Barreras para el aprendizaje y la participación identificadas por contexto (migración 008)."],
    piar_docente: ["Pedagógico", "Relación N:M entre PIAR y docentes; indica el responsable principal y define el alcance del rol Docente."],
    piar_dua: ["Pedagógico", "Estrategias del Diseño Universal para el Aprendizaje por principio: representación, acción y expresión, implicación (migración 013)."],
    psicologa: ["Pedagógico", "Perfil de psicología referenciado por los diagnósticos (id_psicologa). No se usa para autorizar."],
    recuperacion_contrasena: ["Cuentas y seguridad", "Tokens de recuperación de contraseña (hash, un solo uso, 30 minutos)."],
    reporte: ["Pedagógico", "Informes persistentes de un PIAR: instantánea del contenido construida por el servidor, con su hash, autor y fecha (migración 014)."],
    schema_migrations: ["Control", "Registro de migraciones aplicadas con su checksum SHA-256."],
    seguimiento: ["Pedagógico", "Seguimientos del PIAR, opcionalmente enlazados a un ajuste; inmutables una vez registrados."],
    sesion_usuario: ["Cuentas y seguridad", "Sesiones activas: hash del token, vencimiento (8 h) y revocación."],
    usuario: ["Cuentas y seguridad", "Cuentas de acceso: rol, estado, hash de la contraseña (bcrypt), verificación del correo, contraseña temporal y decisión de aprobación."],
    verificacion_correo: ["Cuentas y seguridad", "Tokens de verificación del correo (hash, un solo uso, 24 h)."]
};

const byTable = new Map(tables.map(t => [t.name, columns.filter(c => c.table === t.name).sort((a, b) => a.pos - b.pos)]));
const fkOf = (table, column) => fks.find(f => f.table === table && f.column === column);
const esc = value => String(value).replace(/\|/g, "\\|");
const SENSITIVE = /password_hash|contrasena|token_hash|state_hash|nonce|code_verifier|correo_hash/;

// ---------- Diccionario de datos ----------
let md = `# 11. Diccionario de datos

<!-- sub: Estructura real de las 28 tablas, generada desde el esquema migrado -->

> Generado automáticamente por \`docs/documentacion/herramientas/generar-modelo-datos.js\` a partir de la **estructura** (no de los datos) de un esquema MySQL creado con las migraciones 000–016, idéntico en estructura a \`piar_produccion\`. Fecha de generación: ${new Date().toISOString().slice(0, 10)}.

**Resumen:** ${tables.length} tablas, ${columns.length} columnas, ${fks.length} relaciones de clave foránea (todas con \`ON DELETE NO ACTION\`) y ${indexes.length} índices. Motor InnoDB y juego de caracteres \`utf8mb4\`.

Las columnas marcadas con 🔒 guardan valores derivados de secretos (hashes o tokens). Nunca se muestran en la interfaz, en los registros ni en esta documentación.

## 11.1 Inventario de tablas

Tabla: Inventario de las 28 tablas del esquema

| Tabla | Grupo | Propósito | Columnas |
|---|---|---|---|
${tables.map(t => `| \`${t.name}\` | ${PURPOSE[t.name]?.[0] || "—"} | ${PURPOSE[t.name]?.[1] || "Pendiente de describir."} | ${byTable.get(t.name).length} |`).join("\n")}

`;
let section = 2;
for (const t of tables) {
    md += `## 11.${section++} \`${t.name}\`\n\n${PURPOSE[t.name]?.[1] || ""}\n\n| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |\n|---|---|---|---|---|---|---|\n`;
    for (const c of byTable.get(t.name)) {
        const fk = fkOf(t.name, c.column);
        const notes = [c.extra && c.extra !== "DEFAULT_GENERATED" ? c.extra.replace("DEFAULT_GENERATED ", "") : "", fk ? `FK → \`${fk.refTable}.${fk.refColumn}\`` : "", SENSITIVE.test(c.column) ? "🔒 valor derivado de un secreto" : ""].filter(Boolean).join("; ");
        const key = c.key === "PRI" ? "PK" : c.key === "UNI" ? "UQ" : c.key === "MUL" ? "IDX" : "";
        md += `| ${c.pos} | \`${c.column}\` | \`${esc(c.type)}\` | ${c.nullable === "YES" ? "Sí" : "No"} | ${c.def === "∅" ? "—" : `\`${esc(c.def)}\``} | ${key} | ${esc(notes)} |\n`;
    }
    const tIdx = indexes.filter(i => i.table === t.name);
    if (tIdx.length) md += `\n**Índices:** ${tIdx.map(i => `\`${i.name}\` (${i.unique ? "único" : "no único"}: ${i.cols})`).join(" · ")}\n`;
    md += "\n";
}
fs.writeFileSync(path.join(outDir, "capitulos", "11_diccionario_datos.md"), md);

// ---------- Diagramas ER ----------
const simpleType = type => type.replace(/\(.*$/, "").replace(/\s.*$/, "").toLowerCase();
// Vistas ER: "tables" muestra atributos clave; "refs" son entidades de contexto (solo PK).
const GROUPS = {
    "13_er_pedagogico": { dir: "LR", tables: ["estudiante", "docente", "piar", "piar_docente", "piar_barrera", "piar_ajuste", "piar_ajuste_evidencia", "piar_dua", "diagnostico", "psicologa", "observacion", "seguimiento", "coordinador", "historial", "historial_detalle", "reporte"], refs: [] },
    "14_er_cuentas_seguridad": { dir: "LR", tables: ["usuario", "sesion_usuario", "verificacion_correo", "recuperacion_contrasena", "cambio_correo", "external_identity", "oidc_login_transaction", "admin_account_audit", "evento_seguridad", "piar_auditoria", "limite_solicitudes", "schema_migrations", "estudiante", "docente"], refs: [] },
    "13a_er_nucleo_piar": { dir: "TB", tables: ["estudiante", "piar", "piar_docente", "docente", "piar_barrera", "piar_ajuste", "piar_ajuste_evidencia", "piar_dua"], refs: [] },
    "13b_er_registros": { dir: "LR", tables: ["diagnostico", "psicologa", "observacion", "seguimiento", "coordinador"], refs: ["estudiante", "piar", "docente", "piar_ajuste"] },
    "13c_er_historial_reportes": { dir: "TB", tables: ["historial", "historial_detalle", "reporte"], refs: ["piar", "estudiante"] },
    "14a_er_credenciales": { dir: "LR", tables: ["usuario", "sesion_usuario", "verificacion_correo", "recuperacion_contrasena", "cambio_correo", "external_identity", "oidc_login_transaction"], refs: [] },
    "14b_er_vinculos_auditoria": { dir: "LR", tables: ["admin_account_audit", "evento_seguridad", "piar_auditoria", "limite_solicitudes", "schema_migrations"], refs: ["usuario", "estudiante", "docente"] }
};
const KEY_ATTRS = { estudiante: ["nombre", "estado"], docente: ["nombre", "area"], piar: ["titulo", "periodo", "anio", "estado"], piar_barrera: ["contexto", "fecha_identificacion"], piar_ajuste: ["area", "avance", "estado"], piar_dua: ["principio"], usuario: ["rol", "estado"], seguimiento: ["fecha", "estado"], observacion: ["fecha", "tipo"], diagnostico: ["tipo_diagnostico", "fecha"], reporte: ["tipo", "periodo"], evento_seguridad: ["tipo", "resultado", "id_usuario"], piar_auditoria: ["actor_user_id", "action", "http_status"], admin_account_audit: ["operation"], schema_migrations: ["checksum"], limite_solicitudes: ["conteo", "expira_at"], coordinador: ["nombre"], psicologa: ["nombre"] };
for (const [file, group] of Object.entries(GROUPS)) {
    const all = [...group.tables, ...group.refs];
    const inGroup = new Set(all);
    let er = `erDiagram
  direction ${group.dir}
`;
    for (const name of all) {
        const cols = byTable.get(name) || [];
        const isRef = group.refs.includes(name);
        const shown = cols.filter(c => c.key === "PRI" || (!isRef && (fkOf(name, c.column) || (KEY_ATTRS[name] || []).includes(c.column))));
        const attrs = shown.map(c => `    ${simpleType(c.type)} ${c.column}${c.key === "PRI" ? " PK" : fkOf(name, c.column) ? " FK" : ""}`);
        er += `  ${name} {\n${attrs.join("\n")}\n  }\n`;
    }
    const seen = new Set();
    for (const f of fks) {
        if (!inGroup.has(f.table) || !inGroup.has(f.refTable)) continue;
        if (group.refs.includes(f.table)) continue; // las entidades de contexto no aportan relaciones propias
        const pair = `${f.table}->${f.refTable}:${f.column}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const nullable = columns.find(c => c.table === f.table && c.column === f.column)?.nullable === "YES";
        er += `  ${f.refTable} ${nullable ? "|o" : "||"}--o{ ${f.table} : "${f.column}"
`;
    }
    fs.writeFileSync(path.join(outDir, "diagramas", "fuente", `${file}.mmd`), er);
}
console.log(`Diccionario: ${tables.length} tablas, ${columns.length} columnas, ${fks.length} FK, ${indexes.length} índices. Diagramas ER: ${Object.keys(GROUPS).join(", ")}`);
