"use strict";

// Pruebas del sistema de diseño (fase 2 del rediseño visual): tipografía local,
// tokens, contraste, componentes, movimiento reducido e impresión.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "../public");
const read = file => fs.readFileSync(path.join(PUBLIC, file), "utf8");
const html = read("index.html");
const CSS_FILES = ["css/main.css", "css/components.css", "css/auth.css", "css/dashboard.css", "css/responsive.css"];
const css = Object.fromEntries(CSS_FILES.map(file => [file, read(file)]));
const allCss = Object.values(css).join("\n");
const main = css["css/main.css"];

function token(name) {
    const match = main.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(match, `Falta el token --${name}`);
    return match[1].trim();
}

// Resuelve tokens que apuntan a otros tokens (var(--x)) hasta un color hexadecimal.
function hexToken(name) {
    let value = token(name);
    for (let depth = 0; depth < 5 && value.startsWith("var("); depth += 1) value = token(value.slice(6, -1));
    assert.match(value, /^#[0-9A-Fa-f]{6}$/, `--${name} no es un color hexadecimal`);
    return value;
}

function luminance(hex) {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}

test("index.html carga las hojas del sistema de diseño en orden y sin fuentes externas", () => {
    const order = CSS_FILES.map(file => html.indexOf(`href="${file}"`));
    assert.ok(order.every(index => index > 0), "Falta alguna hoja de estilos en index.html");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "Las hojas deben cargarse en el orden del sistema de diseño");
    assert.doesNotMatch(html + allCss, /fonts\.googleapis|fonts\.gstatic/, "La CSP bloquea Google Fonts; la fuente debe ser local");
    assert.doesNotMatch(allCss, /@import/, "No se permiten @import en las hojas de estilo");
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<title>PIAR - Sistema de Gestión Educativa<\/title>/);
});

test("Poppins se sirve desde public/fonts con archivos WOFF2 válidos y su licencia", () => {
    const sources = [...main.matchAll(/url\("\.\.\/fonts\/poppins\/([^"]+)"\)/g)].map(match => match[1]);
    assert.deepEqual(sources, ["poppins-latin-400-normal.woff2", "poppins-latin-500-normal.woff2", "poppins-latin-600-normal.woff2", "poppins-latin-700-normal.woff2"]);
    for (const file of sources) {
        const content = fs.readFileSync(path.join(PUBLIC, "fonts/poppins", file));
        assert.equal(content.subarray(0, 4).toString("latin1"), "wOF2", `${file} no es WOFF2`);
        assert.ok(content.length > 4000 && content.length < 40000, `${file} tiene un tamaño inesperado`);
    }
    assert.match(fs.readFileSync(path.join(PUBLIC, "fonts/poppins/OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE/i);
    assert.equal((main.match(/font-display: swap/g) || []).length, 4);
    for (const preload of html.matchAll(/<link rel="preload" href="([^"]+)" as="font"[^>]*>/g)) {
        assert.ok(fs.existsSync(path.join(PUBLIC, preload[1])), `La precarga apunta a un archivo inexistente: ${preload[1]}`);
        assert.match(preload[0], /crossorigin/);
    }
});

test("la paleta institucional usa exactamente los colores aprobados", () => {
    const expected = {
        "color-morado": "#642CE8",
        "color-morado-profundo": "#4320A8",
        "color-azul": "#263F83",
        "color-azul-noche": "#111A38",
        "color-azul-desvanecido": "#E9EDFF",
        "color-fondo": "#F5F6FC",
        "color-blanco": "#FFFFFF",
        "color-texto": "#172554",
        "color-texto-secundario": "#64748B",
        "color-turquesa": "#20C9C3"
    };
    for (const [name, value] of Object.entries(expected)) assert.equal(token(name), value, `--${name}`);
});

// Los tokens globales viven en main.css; algunos componentes definen variables locales
// (por ejemplo, el tono de luz del acceso en auth.css). Ninguna puede quedar sin definir.
test("todas las variables CSS usadas están definidas en alguna hoja de estilos", () => {
    const defined = new Set([...allCss.matchAll(/--([a-z0-9-]+):/g)].map(match => match[1]));
    const used = new Set([...allCss.matchAll(/var\(--([a-z0-9-]+)/g)].map(match => match[1]));
    const missing = [...used].filter(name => !defined.has(name));
    assert.deepEqual(missing, [], `Variables sin definir: ${missing.join(", ")}`);
});

test("las combinaciones de texto y fondo cumplen el contraste WCAG AA (4,5:1)", () => {
    const pairs = [
        ["color-texto", "color-blanco"],
        ["color-texto", "color-fondo"],
        ["color-texto-secundario", "color-blanco"],
        ["color-texto-secundario-fondo", "color-fondo"],
        ["color-placeholder", "color-blanco"],
        ["color-blanco", "color-morado"],
        ["color-blanco", "color-morado-profundo"],
        ["color-blanco", "color-azul"],
        ["color-blanco", "color-azul-noche"],
        ["color-blanco", "color-turquesa-oscuro"],
        ["color-azul", "color-azul-desvanecido"],
        ["color-morado-profundo", "color-morado-suave"],
        ["color-morado-profundo", "color-superficie-suave"],
        ["color-exito", "color-exito-fondo"],
        ["color-advertencia", "color-advertencia-fondo"],
        ["color-error", "color-error-fondo"],
        ["color-neutro", "color-neutro-fondo"]
    ];
    for (const [text, background] of pairs) {
        const ratio = contrast(hexToken(text), hexToken(background));
        assert.ok(ratio >= 4.5, `--${text} sobre --${background}: ${ratio.toFixed(2)}:1`);
    }
    // El turquesa es solo decorativo: sobre blanco no alcanza el contraste para texto.
    assert.ok(contrast(hexToken("color-turquesa"), hexToken("color-blanco")) < 4.5);
    assert.match(main, /Turquesa: solo acentos/);
});

test("los componentes del sistema de diseño existen con los nombres que usa el JavaScript", () => {
    const components = css["css/components.css"];
    for (const selector of [".btn-modern", ".small-btn", ".add-btn", ".table-btn", ".danger-btn", ".close-modal",
        ".input-modern", ".search-input", ".form-grid", ".modal-form", ".table-card", ".chart-card", ".info-card",
        ".empty-state", ".modern-table", ".responsive-table", ".status-activo", ".status-revision", ".status-cerrado",
        ".approval-state", ".progress-bar", ".alert", ".trace-form-feedback", ".custom-modal-overlay", ".custom-modal",
        ".modal-header-custom", ".custom-toast", ".custom-toast.warning", ".custom-toast.error"]) {
        assert.ok(components.includes(`${selector} {`) || components.includes(`${selector},`), `Falta el componente ${selector}`);
    }
    // Las definiciones base no se repiten en otras hojas.
    for (const file of ["css/auth.css", "css/dashboard.css"]) {
        assert.doesNotMatch(css[file], /^\.input-modern\s*\{/m, `${file} redefine .input-modern`);
        assert.doesNotMatch(css[file], /^\.btn-modern\s*\{/m, `${file} redefine .btn-modern`);
        assert.doesNotMatch(css[file], /^\.custom-modal\s*\{/m, `${file} redefine .custom-modal`);
        assert.doesNotMatch(css[file], /^\.modern-table\s*\{/m, `${file} redefine .modern-table`);
    }
});

test("cada clase usada en las plantillas de la interfaz tiene estilos definidos", () => {
    const scripts = fs.readdirSync(path.join(PUBLIC, "js")).map(file => read(`js/${file}`)).join("\n");
    const used = new Set();
    for (const [, classes] of scripts.matchAll(/class="([^"$]+)"/g)) {
        for (const name of classes.split(/\s+/)) if (/^[a-z][a-z0-9-]+$/.test(name)) used.add(name);
    }
    const defined = new Set([...allCss.matchAll(/\.([a-z][a-z0-9-]+)/g)].map(match => match[1]));
    // Iconos de Bootstrap Icons y clases que solo sirven de gancho para el JavaScript.
    const hooks = new Set(["auth-feedback", "auth-first-password", "piar-detail", "section-heading-row", "startup-message"]);
    const unstyled = [...used].filter(name => !name.startsWith("bi") && !defined.has(name) && !hooks.has(name));
    assert.deepEqual(unstyled, [], `Clases sin estilo: ${unstyled.join(", ")}`);
});

test("dashboard.css ya no contiene reglas muertas ni colores fijos fuera del sistema", () => {
    const dashboard = css["css/dashboard.css"];
    assert.doesNotMatch(dashboard, /theme-switcher|dark-mode|api-badge|tech-stack-card/);
    const hexColors = dashboard.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
    assert.ok(hexColors.length <= 3, `dashboard.css tiene ${hexColors.length} colores fijos: ${hexColors.join(", ")}`);
    // Ningún contenedor de rejilla fuerza un ancho mínimo mayor que la pantalla.
    assert.doesNotMatch(allCss, /minmax\((?!min\()\d{3}px/, "Usa minmax(min(100%, Npx), 1fr) para no desbordar en móviles");
});

test("la interfaz respeta el movimiento reducido, el foco visible y la impresión clara", () => {
    const responsive = css["css/responsive.css"];
    assert.match(responsive, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/);
    assert.match(responsive, /@media \(max-width: 768px\)/);
    assert.match(responsive, /@media \(max-width: 560px\)/);
    assert.match(responsive, /@media print[\s\S]*background: #FFFFFF/);
    assert.match(responsive, /\.no-print[\s\S]*display: none !important/);
    assert.match(main, /:focus-visible \{\s*outline: 3px solid var\(--color-foco\)/);
    assert.doesNotMatch(css["css/components.css"], /outline:\s*none/, "Ningún componente debe ocultar el foco");
    assert.match(css["css/dashboard.css"], /#appModal :focus-visible/);
});
