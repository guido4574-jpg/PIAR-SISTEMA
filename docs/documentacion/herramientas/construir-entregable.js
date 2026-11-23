"use strict";

// Construye ENTREGABLE_FINAL_PIAR.html (con la estructura e identidad visual de la plantilla institucional)
// y ENTREGABLE_FINAL_PIAR.docx (Word editable) a partir de los capítulos Markdown de capitulos/.
// Uso: node construir-entregable.js <carpeta node_modules con marked y docx> [ruta de la plantilla HTML original]
// La plantilla solo se lee: de ella se extraen los estilos (se guardan en recursos/plantilla-estilos.css).
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const MODULES = path.resolve(process.argv[2] || "");
const TEMPLATE = process.argv[3] ? path.resolve(process.argv[3]) : null;
const req = createRequire(path.join(MODULES, "noop.js"));
const { marked } = req("marked");
const d = req("docx");

const ROOT = path.resolve(__dirname, "..");
const CAP = path.join(ROOT, "capitulos");
const CSS_FILE = path.join(ROOT, "recursos", "plantilla-estilos.css");
const FECHA = "22 de noviembre de 2026";
const COMMIT = "6158d9a";

// ---------- Estilos de la plantilla (solo lectura) ----------
if (TEMPLATE) {
    const html = fs.readFileSync(TEMPLATE, "utf8");
    const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
    if (!css) throw new Error("La plantilla no tiene bloque <style>.");
    fs.writeFileSync(CSS_FILE, css.trim() + "\n");
}
const TEMPLATE_CSS = fs.readFileSync(CSS_FILE, "utf8");

// ---------- Lectura de capítulos ----------
const files = fs.readdirSync(CAP).filter(f => /^\d{2}_.+\.md$/.test(f)).sort();
const chapters = files.map(file => {
    const md = fs.readFileSync(path.join(CAP, file), "utf8").replace(/\r\n/g, "\n");
    const title = (md.match(/^# (.+)$/m) || [])[1];
    const sub = (md.match(/<!-- sub: (.+?) -->/) || [])[1] || "";
    const num = Number(file.slice(0, 2));
    const tokens = marked.lexer(md);
    return { file, num, title, short: title.replace(/^\d+\.\s*/, ""), sub, tokens };
});
if (chapters.length !== 24) throw new Error(`Se esperaban 24 capítulos y hay ${chapters.length}.`);

const STATUS = {
    "IMPLEMENTADO": { cls: "b-a", fill: "D1ECF1", color: "0C5460" },
    "PROBADO LOCAL": { cls: "b-g", fill: "D4EDDA", color: "155724" },
    "PRODUCCIÓN": { cls: "b-p", fill: "1E5C00", color: "FFFFFF" },
    "PENDIENTE": { cls: "b-r", fill: "F8D7DA", color: "721C24" }
};
const STATUS_RE = /\[(IMPLEMENTADO|PROBADO LOCAL|PRODUCCIÓN|PENDIENTE)\]/g;
const calloutKind = text => {
    const t = text.toLowerCase();
    if (/^(importante|pendiente)/.test(t)) return "r";
    if (/^(atención|antes de empezar)/.test(t)) return "o";
    return "";
};
const resolveImage = href => path.resolve(CAP, href);
const stats = { figuras: 0, tablas: 0, imagenesFaltantes: [] };

// ======================================================================
// HTML
// ======================================================================
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const imageCache = new Map();
function dataUri(file) {
    if (!imageCache.has(file)) {
        if (!fs.existsSync(file)) { stats.imagenesFaltantes.push(file); return ""; }
        const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
        imageCache.set(file, `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`);
    }
    return imageCache.get(file);
}
function badgesHtml(html) {
    return html.replace(STATUS_RE, (m, k) => `<span class="b ${STATUS[k].cls}">${k === "PROBADO LOCAL" ? "Probado local" : k.charAt(0) + k.slice(1).toLowerCase()}</span>`);
}
function inlineHtml(tokens = []) {
    return tokens.map(t => {
        switch (t.type) {
            case "text": return t.tokens ? inlineHtml(t.tokens) : badgesHtml(esc(t.text));
            case "escape": return esc(t.text);
            case "strong": return `<strong>${inlineHtml(t.tokens)}</strong>`;
            case "em": return `<em>${inlineHtml(t.tokens)}</em>`;
            case "codespan": return `<code>${t.text}</code>`; // marked ya escapa el contenido
            case "link": return `<a href="${esc(t.href)}" target="_blank" rel="noopener">${inlineHtml(t.tokens)}</a>`;
            case "br": return "<br>";
            case "html": return "";
            default: return esc(t.raw || "");
        }
    }).join("");
}
function figureHtml(img, num) {
    return `<figure><img src="${dataUri(resolveImage(img.href))}" alt="${esc(img.text)}"><figcaption><strong>Figura ${num}.</strong> ${esc(img.text)}</figcaption></figure>`;
}
function listHtml(list) {
    const tag = list.ordered ? "ol" : "ul";
    return `<${tag}>${list.items.map(item => `<li>${item.tokens.map(tk => tk.type === "list" ? listHtml(tk) : tk.type === "text" ? inlineHtml(tk.tokens || [{ type: "text", text: tk.text }]) : tk.type === "paragraph" ? inlineHtml(tk.tokens) : "").join("")}</li>`).join("")}</${tag}>`;
}
function tableHtml(t, caption) {
    let out = caption ? `<p class="tcap"><strong>Tabla ${caption.num}.</strong> ${esc(caption.text)}</p>` : "";
    out += `<div class="tw"><table><thead><tr>${t.header.map(h => `<th>${inlineHtml(h.tokens)}</th>`).join("")}</tr></thead><tbody>`;
    out += t.rows.map(r => `<tr>${r.map(c => `<td>${inlineHtml(c.tokens)}</td>`).join("")}</tr>`).join("");
    return out + "</tbody></table></div>";
}
function blocksHtml(tokens, counters) {
    let html = "";
    let pendingCaption = null;
    for (const t of tokens) {
        if (t.type === "paragraph") {
            const only = t.tokens.length === 1 && t.tokens[0].type === "image" ? t.tokens[0] : null;
            if (only) { counters.fig += 1; html += figureHtml(only, counters.fig); continue; }
            const cap = t.text.match(/^Tabla: (.+)$/);
            if (cap) { pendingCaption = cap[1]; continue; }
            html += `<p>${inlineHtml(t.tokens)}</p>`;
        } else if (t.type === "heading" && t.depth === 3) {
            html += `<h4>${inlineHtml(t.tokens)}</h4>`;
        } else if (t.type === "list") {
            html += listHtml(t);
        } else if (t.type === "table") {
            let caption = null;
            if (pendingCaption) { counters.tab += 1; caption = { num: counters.tab, text: pendingCaption }; pendingCaption = null; }
            html += tableHtml(t, caption);
        } else if (t.type === "blockquote") {
            const first = t.tokens.find(x => x.type === "paragraph");
            const kind = calloutKind(first ? first.text.replace(/\*\*/g, "") : "");
            html += `<div class="hb${kind ? " " + kind : ""}">${blocksHtml(t.tokens, counters)}</div>`;
        } else if (t.type === "code") {
            html += `<pre><code>${esc(t.text)}</code></pre>`;
        }
    }
    return html;
}
function chapterHtml(ch, counters) {
    let body = "";
    let card = null;
    const flush = () => { if (card) { body += `<div class="c">${card.title ? `<h3>${card.title}</h3>` : ""}${blocksHtml(card.tokens, counters)}</div>`; } card = null; };
    for (const t of ch.tokens) {
        if (t.type === "heading" && t.depth === 1) continue;
        if (t.type === "html") continue;
        if (t.type === "heading" && t.depth === 2) { flush(); card = { title: inlineHtml(t.tokens), tokens: [] }; continue; }
        if (!card) card = { title: "", tokens: [] };
        card.tokens.push(t);
    }
    flush();
    return `\n<!-- ==================== CAPÍTULO ${ch.num} ==================== -->\n<section id="s${ch.num}" class="sec">\n    <div class="sec-h"><h2>${esc(ch.title)}</h2><p>${esc(ch.sub)}</p></div>\n${body}\n</section>`;
}

// Correspondencia con las 20 secciones de la guía de la plantilla.
const GUIA = [
    ["1. Planteamiento del problema y justificación", "Capítulos 2 y 3"], ["2. Objetivos", "Capítulo 4"],
    ["3. Alcance y requerimientos", "Capítulos 5, 6 y 7"], ["4. Metodología", "Capítulo 1 (1.4)"],
    ["5. Modelado y diseño", "Capítulos 7 y 9"], ["6. Arquitectura", "Capítulo 8"],
    ["7. Base de datos", "Capítulos 10 y 11"], ["8. Interfaces", "Capítulos 9 (9.4), 12 y 14"],
    ["9. Desarrollo", "Capítulos 12, 13 y 17"], ["10. Integración y tecnologías emergentes", "Capítulo 8 (8.7)"],
    ["11. Pruebas y calidad", "Capítulo 18"], ["12. Implementación y despliegue", "Capítulos 13 y 19"],
    ["13. Documentación técnica y de usuario", "Capítulos 13, 14 y 20"], ["14. Capacitación y entrega", "Capítulo 21 (21.5), pendiente"],
    ["15. Evaluación y mejora continua", "Capítulos 18, 21 y 23"], ["16. Riesgos", "Capítulo 21 (21.3)"],
    ["17. Cronograma", "Capítulo 1 (1.5)"], ["18. Presupuesto", "Capítulo 21 (21.6)"],
    ["19. Conclusiones", "Capítulo 23"], ["20. Bibliografía", "Capítulo 24"]
];

function buildHtml() {
    const counters = { fig: 0, tab: 0 };
    const sections = chapters.map(ch => chapterHtml(ch, counters)).join("\n");
    stats.figuras = counters.fig;
    stats.tablas = counters.tab;
    const extraCss = `
        /* Añadidos para el entregable del Sistema PIAR (no alteran los estilos de la plantilla) */
        .b-p{background:var(--sd);color:#fff}
        .tw{overflow-x:auto;margin:6px 0 14px}
        .tw table{margin:0;min-width:560px}
        .tcap{font-size:.86rem;color:var(--sd);margin:16px 0 2px}
        figure{margin:18px 0;text-align:center;break-inside:avoid}
        figure img{max-width:100%;height:auto;border:1px solid #e0e0e0;border-radius:6px;background:#fff}
        figcaption{font-size:.85rem;color:var(--tl);margin-top:6px}
        pre{background:#1e2a16;color:#e8f5df;padding:14px 16px;border-radius:6px;overflow-x:auto;font-size:.8rem;line-height:1.5;margin:10px 0}
        code{font-family:Consolas,'Courier New',monospace;background:#eef5e9;color:#1e3d0f;padding:1px 5px;border-radius:4px;font-size:.86em}
        pre code{background:none;color:inherit;padding:0}
        td code,th code{word-break:break-word}
        .c a{color:var(--sd)}
        .toc{columns:2;column-gap:28px;padding-left:22px}
        .toc li{break-inside:avoid}
        @media(max-width:992px){.toc{columns:1}}
        @media print{.tw{overflow:visible}pre{white-space:pre-wrap}.sec{break-inside:auto}}`;
    const nav = chapters.map(ch => `        <a href="#s${ch.num}"><span class="n">${ch.num}</span> ${esc(ch.short)}</a>`).join("\n");
    const toc = chapters.map(ch => `<li><a href="#s${ch.num}">${esc(ch.short)}</a></li>`).join("");
    const legend = Object.keys(STATUS).map(k => `<span class="b ${STATUS[k].cls}">${k === "PROBADO LOCAL" ? "Probado local" : k.charAt(0) + k.slice(1).toLowerCase()}</span>`).join(" ");
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sistema PIAR — Entregable final</title>
    <style>
        ${TEMPLATE_CSS.trim()}
${extraCss}
    </style>
</head>
<body>
<button class="mb" onclick="document.querySelector('.sb').classList.toggle('op')" aria-label="Abrir o cerrar el menú">&#9776;</button>

<div class="sb">
    <div class="sb-h">
        <div class="sb-l">PIAR</div>
        <h2>Entregable Final</h2>
    </div>
    <nav>
        <a href="#cover"><span class="n">i</span> Portada</a>
        <a href="#control"><span class="n">!</span> Control del documento</a>
${nav}
        <a href="#eval"><span class="n">E</span> Correspondencia con la guía</a>
    </nav>
</div>

<div class="mc">

<!-- PORTADA -->
<section id="cover" class="cv">
    <div class="cv-c">
        <div class="cv-l">PIAR</div>
        <h1>Sistema <span>PIAR</span></h1>
        <p class="sub">Plan Individual de Ajustes Razonables · Colegio Reinaldo Matiz</p>
        <div class="cv-tipo">Entregable final · Documentación integral</div>
        <div class="cv-info">
            <div class="cv-i"><strong>Programa:</strong> Tecnología en Análisis y Desarrollo de Software</div>
            <div class="cv-i"><strong>Ficha:</strong> Por completar</div>
            <div class="cv-i"><strong>Instructor:</strong> Luis Alfonso Becerra Rentería</div>
            <div class="cv-i"><strong>Equipo:</strong> Por completar</div>
            <div class="cv-i"><strong>Versión:</strong> Commit ${COMMIT}</div>
            <div class="cv-i"><strong>Fecha:</strong> ${FECHA}</div>
            <div class="cv-i"><strong>Formato:</strong> HTML y Word (.docx)</div>
            <div class="cv-i"><strong>Repositorio:</strong> guido4574-jpg/PIAR-SISTEMA</div>
        </div>
    </div>
</section>

<!-- CONTROL DEL DOCUMENTO -->
<section id="control" class="sec">
    <div class="sec-h">
        <h2>Control del documento</h2>
        <p>Alcance, convenciones de estado y contenido de este entregable</p>
    </div>
    <div class="c">
        <h3>Este documento en cifras</h3>
        <div class="g3">
            <div class="sc"><div class="sn">24</div><div class="sl">Capítulos</div></div>
            <div class="sc"><div class="sn">${stats.figuras}</div><div class="sl">Figuras (diagramas y capturas)</div></div>
            <div class="sc"><div class="sn">352/352</div><div class="sl">Pruebas unitarias aprobadas</div></div>
        </div>
    </div>
    <div class="c">
        <h3>Convenciones de estado</h3>
        <p>${legend}</p>
        <p>Cada afirmación relevante indica si la funcionalidad está <strong>implementada</strong> en el código, <strong>probada localmente</strong> con datos sintéticos, <strong>verificada en producción</strong> o <strong>pendiente</strong>. El detalle está en el capítulo 1.3.</p>
        <div class="hb r">
            <h4>&#9888; Importante</h4>
            <p>Este documento describe la versión <code>${COMMIT}</code> del ${FECHA}. No contiene contraseñas, tokens, claves ni datos personales de estudiantes. Las capturas provienen de una demostración con datos sintéticos.</p>
        </div>
    </div>
    <div class="c">
        <h3>Tabla de contenido</h3>
        <ol class="toc">${toc}</ol>
    </div>
</section>
${sections}

<!-- CORRESPONDENCIA CON LA GUÍA -->
<section id="eval" class="sec">
    <div class="sec-h"><h2>Correspondencia con la guía del entregable</h2><p>Dónde se desarrolla cada una de las 20 secciones de la guía institucional</p></div>
    <div class="c">
        <div class="tw"><table><thead><tr><th>Sección de la guía</th><th>Desarrollo en este documento</th></tr></thead><tbody>
${GUIA.map(([a, b]) => `            <tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("\n")}
        </tbody></table></div>
    </div>
</section>

<footer>
    <p><strong>Sistema PIAR</strong> · Colegio Reinaldo Matiz · Documentación generada el ${FECHA} a partir del commit ${COMMIT}</p>
</footer>

</div>
</body>
</html>
`;
}

// ======================================================================
// DOCX
// ======================================================================
const FONT = "Arial";
const MONO = "Consolas";
const GREEN = "39A900", DARK = "1E5C00", ORANGE = "FF6B00", GREY = "666666";
const PAGE_W = 12240, PAGE_H = 15840, MARGIN = 1440, CONTENT_W = PAGE_W - 2 * MARGIN; // carta, márgenes de 1"
const MAX_IMG_W = 624, MAX_IMG_H = 760; // píxeles a 96 ppp (6,5" × 7,9")

function imageSize(buf) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: "png" };
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: "jpg" };
        i += 2 + len;
    }
    throw new Error("Imagen no reconocida");
}

function runsFromInline(tokens = [], base = {}) {
    const out = [];
    for (const t of tokens) {
        if (t.type === "text") {
            if (t.tokens) { out.push(...runsFromInline(t.tokens, base)); continue; }
            const text = t.text.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            let last = 0;
            for (const m of text.matchAll(STATUS_RE)) {
                if (m.index > last) out.push(new d.TextRun({ ...base, text: text.slice(last, m.index) }));
                const s = STATUS[m[1]];
                out.push(new d.TextRun({ ...base, text: ` ${m[1] === "PROBADO LOCAL" ? "Probado local" : m[1].charAt(0) + m[1].slice(1).toLowerCase()} `, bold: true, size: 16, color: s.color, shading: { type: d.ShadingType.CLEAR, fill: s.fill, color: "auto" } }));
                last = m.index + m[0].length;
            }
            if (last < text.length) out.push(new d.TextRun({ ...base, text: text.slice(last) }));
        } else if (t.type === "escape") out.push(new d.TextRun({ ...base, text: t.text }));
        else if (t.type === "strong") out.push(...runsFromInline(t.tokens, { ...base, bold: true }));
        else if (t.type === "em") out.push(...runsFromInline(t.tokens, { ...base, italics: true }));
        else if (t.type === "codespan") {
            const text = t.text.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            out.push(new d.TextRun({ ...base, text, font: MONO, size: base.size ? base.size - 1 : 19, color: "1E3D0F", shading: { type: d.ShadingType.CLEAR, fill: "EEF5E9", color: "auto" } }));
        } else if (t.type === "link") {
            out.push(new d.ExternalHyperlink({ link: t.href, children: runsFromInline(t.tokens, { ...base, color: "0B5394", underline: {} }) }));
        } else if (t.type === "br") out.push(new d.TextRun({ ...base, break: 1 }));
    }
    return out;
}

const docState = { fig: 0, tab: 0, list: 0, skipBreak: false };
function captionPara(text) {
    return new d.Paragraph({ style: "Caption", alignment: d.AlignmentType.CENTER, children: runsFromInline(marked.lexer(text)[0]?.tokens || [{ type: "text", text }]) });
}
function figureDocx(img) {
    const file = resolveImage(img.href);
    if (!fs.existsSync(file)) { stats.imagenesFaltantes.push(file); return []; }
    const data = fs.readFileSync(file);
    const size = imageSize(data);
    const isDiagram = file.includes(`${path.sep}diagramas${path.sep}`);
    const natW = isDiagram ? size.w / 2 : size.w; // los diagramas se renderizan a escala 2
    const natH = isDiagram ? size.h / 2 : size.h;
    const scale = Math.min(1, MAX_IMG_W / natW, MAX_IMG_H / natH);
    docState.fig += 1;
    return [
        new d.Paragraph({ alignment: d.AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new d.ImageRun({ type: size.type, data, transformation: { width: Math.round(natW * scale), height: Math.round(natH * scale) }, altText: { title: img.text, description: img.text, name: path.basename(file) } })] }),
        new d.Paragraph({ style: "Caption", alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: `Figura ${docState.fig}. `, bold: true }), new d.TextRun({ text: img.text })] })
    ];
}
function listDocx(list, level = 0, instance = null) {
    const inst = instance ?? ++docState.list;
    const out = [];
    for (const item of list.items) {
        const inline = [];
        const nested = [];
        for (const tk of item.tokens) {
            if (tk.type === "list") nested.push(tk);
            else if (tk.type === "text") inline.push(...(tk.tokens || [{ type: "text", text: tk.text }]));
            else if (tk.type === "paragraph") inline.push(...tk.tokens);
        }
        out.push(new d.Paragraph({ numbering: { reference: list.ordered ? "numeros" : "vinetas", level, instance: list.ordered ? inst : undefined }, spacing: { after: 60 }, children: runsFromInline(inline) }));
        for (const n of nested) out.push(...listDocx(n, level + 1, n.ordered ? ++docState.list : null));
    }
    return out;
}
function tableDocx(t, caption) {
    const out = [];
    if (caption) { docState.tab += 1; out.push(new d.Paragraph({ style: "Caption", keepNext: true, children: [new d.TextRun({ text: `Tabla ${docState.tab}. `, bold: true }), ...runsFromInline(marked.lexer(caption)[0]?.tokens || [])] })); }
    const cols = t.header.length;
    const lens = t.header.map((h, i) => Math.max(h.text.length, ...t.rows.map(r => Math.min((r[i]?.text || "").length, 220))));
    const weights = lens.map(l => Math.max(6, Math.sqrt(l)));
    const total = weights.reduce((a, b) => a + b, 0);
    let widths = weights.map(w => Math.max(900, Math.round(CONTENT_W * w / total)));
    const diff = CONTENT_W - widths.reduce((a, b) => a + b, 0);
    widths[widths.indexOf(Math.max(...widths))] += diff;
    const size = cols >= 6 ? 15 : cols >= 4 ? 17 : 18;
    const border = { style: d.BorderStyle.SINGLE, size: 4, color: "D0D7CC" };
    const cell = (tokens, w, header, shade) => new d.TableCell({
        width: { size: w, type: d.WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 90, right: 90 },
        shading: header ? { type: d.ShadingType.CLEAR, fill: GREEN, color: "auto" } : shade ? { type: d.ShadingType.CLEAR, fill: "F4F8F1", color: "auto" } : undefined,
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new d.Paragraph({ spacing: { after: 0, line: 252 }, children: runsFromInline(tokens, header ? { bold: true, color: "FFFFFF", size } : { size }) })]
    });
    out.push(new d.Table({
        width: { size: CONTENT_W, type: d.WidthType.DXA },
        columnWidths: widths,
        rows: [
            new d.TableRow({ tableHeader: true, cantSplit: true, children: t.header.map((h, i) => cell(h.tokens, widths[i], true)) }),
            ...t.rows.map((r, ri) => new d.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c.tokens, widths[i], false, ri % 2 === 1)) }))
        ]
    }));
    out.push(new d.Paragraph({ spacing: { after: 120 }, children: [] }));
    return out;
}
function calloutDocx(t) {
    const first = t.tokens.find(x => x.type === "paragraph");
    const kind = calloutKind(first ? first.text.replace(/\*\*/g, "") : "");
    const color = kind === "r" ? "E53935" : kind === "o" ? ORANGE : GREEN;
    const fill = kind === "r" ? "FCE4EC" : kind === "o" ? "FFF3E0" : "E8F5E9";
    const para = children => new d.Paragraph({ shading: { type: d.ShadingType.CLEAR, fill, color: "auto" }, border: { left: { style: d.BorderStyle.SINGLE, size: 24, color, space: 8 } }, indent: { left: 160, right: 120 }, spacing: { before: 60, after: 60 }, children });
    const out = [];
    for (const tk of t.tokens) {
        if (tk.type === "paragraph") out.push(para(runsFromInline(tk.tokens, { size: 20 })));
        else if (tk.type === "list") for (const item of tk.items) out.push(para([new d.TextRun({ text: "•  ", size: 20 }), ...runsFromInline(item.tokens.flatMap(x => x.tokens || []), { size: 20 })]));
    }
    return out;
}
function codeDocx(t) {
    const lines = t.text.split("\n");
    return lines.map((line, i) => new d.Paragraph({
        shading: { type: d.ShadingType.CLEAR, fill: "F3F6F1", color: "auto" },
        border: i === 0 ? { top: { style: d.BorderStyle.SINGLE, size: 4, color: "D0D7CC", space: 4 } } : i === lines.length - 1 ? { bottom: { style: d.BorderStyle.SINGLE, size: 4, color: "D0D7CC", space: 4 } } : undefined,
        spacing: { before: 0, after: i === lines.length - 1 ? 160 : 0, line: 240 },
        keepLines: true,
        children: [new d.TextRun({ text: line || " ", font: MONO, size: 16 })]
    }));
}
function blocksDocx(tokens) {
    const out = [];
    let pendingCaption = null;
    for (const t of tokens) {
        if (t.type === "heading") {
            if (t.depth === 1) { out.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: !docState.skipBreak, children: runsFromInline(t.tokens) })); docState.skipBreak = false; }
            else if (t.depth === 2) out.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: runsFromInline(t.tokens) }));
            else out.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_3, children: runsFromInline(t.tokens) }));
        } else if (t.type === "html") {
            const sub = t.text.match(/<!-- sub: (.+?) -->/);
            if (sub) out.push(new d.Paragraph({ style: "Subtitulo", children: [new d.TextRun({ text: sub[1] })] }));
        } else if (t.type === "paragraph") {
            const only = t.tokens.length === 1 && t.tokens[0].type === "image" ? t.tokens[0] : null;
            if (only) { out.push(...figureDocx(only)); continue; }
            const cap = t.text.match(/^Tabla: (.+)$/);
            if (cap) { pendingCaption = cap[1]; continue; }
            out.push(new d.Paragraph({ children: runsFromInline(t.tokens) }));
        } else if (t.type === "list") out.push(...listDocx(t));
        else if (t.type === "table") { out.push(...tableDocx(t, pendingCaption)); pendingCaption = null; }
        else if (t.type === "blockquote") out.push(...calloutDocx(t));
        else if (t.type === "code") out.push(...codeDocx(t));
    }
    return out;
}

function header() {
    return new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } }, children: [new d.TextRun({ text: "Sistema PIAR · Entregable final · Documentación integral", size: 16, color: GREY })] })] });
}
function footer() {
    return new d.Footer({ children: [new d.Paragraph({ border: { top: { style: d.BorderStyle.SINGLE, size: 4, color: "D0D7CC", space: 4 } }, children: [
        new d.TextRun({ text: `Colegio Reinaldo Matiz · Commit ${COMMIT}`, size: 16, color: GREY }),
        new d.TextRun({ children: [new d.PositionalTab({ alignment: d.PositionalTabAlignment.RIGHT, relativeTo: d.PositionalTabRelativeTo.MARGIN, leader: d.PositionalTabLeader.NONE }), "Página ", d.PageNumber.CURRENT], size: 16, color: GREY })
    ] })] });
}

function coverChildren() {
    const info = [
        ["Programa", "Tecnología en Análisis y Desarrollo de Software"], ["Ficha", "Por completar"],
        ["Instructor", "Luis Alfonso Becerra Rentería"], ["Equipo", "Por completar"],
        ["Institución beneficiaria", "Colegio Reinaldo Matiz"], ["Versión documentada", `Commit ${COMMIT}`],
        ["Repositorio", "guido4574-jpg/PIAR-SISTEMA"], ["Fecha", FECHA]
    ];
    const border = { style: d.BorderStyle.SINGLE, size: 4, color: "FFFFFF" };
    return [
        new d.Paragraph({ spacing: { before: 1800, after: 0 }, alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: "PIAR", bold: true, size: 40, color: GREEN, font: FONT })] }),
        new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: 200, after: 120 }, children: [new d.TextRun({ text: "Sistema ", bold: true, size: 64, color: DARK }), new d.TextRun({ text: "PIAR", bold: true, size: 64, color: ORANGE })] }),
        new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 360 }, children: [new d.TextRun({ text: "Plan Individual de Ajustes Razonables · Colegio Reinaldo Matiz", size: 26, color: "333333" })] }),
        new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 600 }, border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: ORANGE, space: 8 } }, children: [new d.TextRun({ text: "Entregable final · Documentación integral", bold: true, size: 28, color: ORANGE })] }),
        new d.Table({
            width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [2800, CONTENT_W - 2800],
            rows: info.map(([k, v]) => new d.TableRow({ children: [
                new d.TableCell({ width: { size: 2800, type: d.WidthType.DXA }, shading: { type: d.ShadingType.CLEAR, fill: DARK, color: "auto" }, borders: { top: border, bottom: border, left: border, right: border }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [new d.Paragraph({ spacing: { after: 0 }, children: [new d.TextRun({ text: k, bold: true, color: "FFFFFF", size: 20 })] })] }),
                new d.TableCell({ width: { size: CONTENT_W - 2800, type: d.WidthType.DXA }, shading: { type: d.ShadingType.CLEAR, fill: "E8F5DF", color: "auto" }, borders: { top: border, bottom: border, left: border, right: border }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [new d.Paragraph({ spacing: { after: 0 }, children: [new d.TextRun({ text: v, size: 20 })] })] })
            ] }))
        }),
        new d.Paragraph({ spacing: { before: 600 }, alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: "Formato: Word (.docx) editable · Versión equivalente en HTML: ENTREGABLE_FINAL_PIAR.html", size: 18, color: GREY })] })
    ];
}

function controlChildren() {
    const md = `# Control del documento

<!-- sub: Alcance, convenciones de estado y contenido de este entregable -->

## Alcance

Este documento describe la versión \`${COMMIT}\` del Sistema PIAR, fechada el ${FECHA}. Reúne en 24 capítulos la documentación técnica, funcional y de usuario. No contiene contraseñas, tokens, claves ni datos personales de estudiantes. Las capturas provienen de una demostración con datos sintéticos.

## Convenciones de estado

Tabla: Etiquetas de estado

| Etiqueta | Significado |
|---|---|
| [IMPLEMENTADO] | La funcionalidad existe en el código |
| [PROBADO LOCAL] | Se comprobó en el equipo de desarrollo con datos sintéticos |
| [PRODUCCIÓN] | Se verificó en el entorno publicado en Railway |
| [PENDIENTE] | Falta configurarla, probarla o decidirla |

## Correspondencia con la guía del entregable

Tabla: Dónde se desarrolla cada sección de la guía institucional

| Sección de la guía | Desarrollo en este documento |
|---|---|
${GUIA.map(([a, b]) => `| ${a} | ${b} |`).join("\n")}
`;
    const blocks = blocksDocx(marked.lexer(md));
    // El primer título no fuerza salto de página: la sección ya empieza en página nueva.
    blocks[0] = new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new d.TextRun("Control del documento")] });
    return blocks;
}

async function buildDocx() {
    docState.fig = 0; docState.tab = 0; docState.list = 0;
    const content = [];
    docState.skipBreak = true;
    for (const ch of chapters) content.push(...blocksDocx(ch.tokens));
    const front = controlChildren();
    docState.skipBreak = false;
    const toc = [
        new d.Paragraph({ style: "TituloIndice", children: [new d.TextRun("Tabla de contenido")] }),
        new d.TableOfContents("Tabla de contenido", { hyperlink: true, headingStyleRange: "1-2" })
    ];
    const listLevels = fmt => [0, 1, 2].map(level => ({ level, format: fmt === "b" ? d.LevelFormat.BULLET : d.LevelFormat.DECIMAL, text: fmt === "b" ? ["•", "◦", "▪"][level] : `%${level + 1}.`, alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 540 + level * 360, hanging: 300 } } } }));
    const doc = new d.Document({
        creator: "Equipo del proyecto PIAR",
        title: "Sistema PIAR — Entregable final",
        subject: "Documentación integral del Sistema PIAR",
        description: `Documentación técnica, funcional y de usuario. Versión ${COMMIT}.`,
        keywords: "PIAR, ajustes razonables, Node.js, MySQL, Railway",
        styles: {
            default: { document: { run: { font: FONT, size: 22, color: "222222", language: { value: "es-CO" } }, paragraph: { spacing: { after: 120, line: 276 } } } },
            paragraphStyles: [
                { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 34, bold: true, color: DARK }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 0, border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: ORANGE, space: 6 } } } },
                { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 26, bold: true, color: DARK }, paragraph: { spacing: { before: 300, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 1 } },
                { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 23, bold: true, color: GREEN }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 2 } },
                { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 18, italics: false, color: "444444" }, paragraph: { spacing: { before: 60, after: 180 } } },
                { id: "TituloIndice", name: "Título del índice", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 34, bold: true, color: DARK }, paragraph: { spacing: { before: 0, after: 240 }, border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: ORANGE, space: 6 } } } },
                { id: "Subtitulo", name: "Subtítulo de capítulo", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 22, italics: true, color: GREY }, paragraph: { spacing: { before: 0, after: 240 } } }
            ]
        },
        numbering: { config: [{ reference: "vinetas", levels: listLevels("b") }, { reference: "numeros", levels: listLevels("n") }] },
        sections: [
            { properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } }, children: coverChildren() },
            { properties: { type: d.SectionType.NEXT_PAGE, page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 708, footer: 708 }, pageNumbers: { start: 1, formatType: d.NumberFormat.LOWER_ROMAN } } }, headers: { default: header() }, footers: { default: footer() }, children: [...toc, ...front] },
            { properties: { type: d.SectionType.NEXT_PAGE, page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 708, footer: 708 }, pageNumbers: { start: 1, formatType: d.NumberFormat.DECIMAL } } }, headers: { default: header() }, footers: { default: footer() }, children: content }
        ]
    });
    // El primer capítulo no necesita salto propio: la sección ya empieza en página nueva (evita una página en blanco).
    return d.Packer.toBuffer(doc);
}

(async () => {
    const html = buildHtml();
    fs.writeFileSync(path.join(ROOT, "ENTREGABLE_FINAL_PIAR.html"), html);
    const htmlStats = { ...stats };
    const buf = await buildDocx();
    fs.writeFileSync(path.join(ROOT, "ENTREGABLE_FINAL_PIAR.docx"), buf);
    console.log(`HTML: ${(html.length / 1048576).toFixed(2)} MB, ${htmlStats.figuras} figuras, ${htmlStats.tablas} tablas con título`);
    console.log(`DOCX: ${(buf.length / 1048576).toFixed(2)} MB, ${docState.fig} figuras, ${docState.tab} tablas con título`);
    if (stats.imagenesFaltantes.length) { console.error("Imágenes faltantes:\n" + [...new Set(stats.imagenesFaltantes)].join("\n")); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exitCode = 1; });
