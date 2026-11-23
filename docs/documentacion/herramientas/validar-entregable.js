"use strict";

// Valida ENTREGABLE_FINAL_PIAR.html en Chrome sin interfaz (errores, imágenes, secciones vacías,
// desbordamiento en móvil) y revisa la estructura interna de ENTREGABLE_FINAL_PIAR.docx.
// Uso: node validar-entregable.js [carpeta para capturas de revisión]
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "ENTREGABLE_FINAL_PIAR.html");
const DOCX = path.join(ROOT, "ENTREGABLE_FINAL_PIAR.docx");
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9343;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function validateHtml() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "piar-valida-"));
    const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(work, "perfil")}`, "--no-first-run", "--disable-gpu", "--disable-extensions", "about:blank"], { stdio: "ignore" });
    try {
        let targets = [];
        for (let i = 0; i < 60 && !targets.length; i += 1) {
            try { targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(t => t.type === "page"); } catch { /* espera */ }
            if (!targets.length) await sleep(250);
        }
        const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
        await new Promise(r => ws.addEventListener("open", r));
        let seq = 0;
        const pending = new Map();
        const errors = [];
        const requests = [];
        ws.addEventListener("message", ev => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
            if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
            if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
            if (m.method === "Network.requestWillBeSent" && !m.params.request.url.startsWith("data:") && !m.params.request.url.startsWith("file:")) requests.push(m.params.request.url);
        });
        const send = (method, params = {}) => new Promise(r => { seq += 1; pending.set(seq, r); ws.send(JSON.stringify({ id: seq, method, params })); });
        const evaluate = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
        await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Page.enable");
        await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url: pathToFileURL(HTML).href });
        for (let i = 0; i < 80; i += 1) { if (await evaluate("document.readyState === 'complete'")) break; await sleep(250); }
        await sleep(800);
        const info = await evaluate(`(() => {
            const imgs = [...document.images];
            const sections = [...document.querySelectorAll('section.sec[id^="s"]')];
            const emptyCards = [...document.querySelectorAll('.c')].filter(c => c.textContent.replace(/\\s+/g, '').length < 40 && !c.querySelector('img')).length;
            const emptySections = sections.filter(s => s.querySelectorAll('.c').length === 0 || s.textContent.replace(/\\s+/g, '').length < 200).map(s => s.id);
            const navLinks = [...document.querySelectorAll('.sb nav a')];
            const brokenLinks = navLinks.filter(a => !document.querySelector(a.getAttribute('href'))).map(a => a.getAttribute('href'));
            const text = document.body.innerText;
            return { title: document.title, imgs: imgs.length, broken: imgs.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.alt), sections: sections.length, emptyCards, emptySections,
                navLinks: navLinks.length, brokenLinks, tables: document.querySelectorAll('table').length,
                badges: document.querySelectorAll('.b').length, leftovers: (text.match(/undefined|NaN|\\[object Object\\]|\\[(IMPLEMENTADO|PENDIENTE|PRODUCCIÓN|PROBADO LOCAL)\\]/g) || []).length,
                templateText: /Sistema de Gestión de Inventarios|SGI\\b|eib/.test(text) };
        })()`);
        check("El HTML abre en Chrome y tiene título", !!info.title, info.title);
        check("24 capítulos (secciones s1–s24)", info.sections === 24, `${info.sections}`);
        check("Ninguna sección vacía", info.emptySections.length === 0, info.emptySections.join(", ") || "0 vacías");
        check("Ninguna tarjeta vacía", info.emptyCards === 0, `${info.emptyCards}`);
        check("Todas las imágenes cargan", info.broken.length === 0, `${info.imgs} imágenes; rotas: ${info.broken.length}`);
        check("Enlaces del menú válidos", info.brokenLinks.length === 0, `${info.navLinks} enlaces; rotos: ${info.brokenLinks.join(", ") || 0}`);
        check("Sin textos residuales (undefined, NaN, etiquetas sin convertir)", info.leftovers === 0, `${info.leftovers}`);
        check("Sin contenido de ejemplo de la plantilla", !info.templateText, info.templateText ? "quedan restos" : "ninguno");
        check("Sin errores de JavaScript ni de consola", errors.length === 0, errors.join(" | ") || "0");
        check("Sin peticiones de red externas", requests.length === 0, requests.join(", ") || "0");
        results.push({ name: "Datos", ok: true, detail: `${info.tables} tablas, ${info.badges} etiquetas de estado` });
        if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            const shot = async (file, clip) => fs.writeFileSync(path.join(SHOTS, file), Buffer.from((await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) })).result.data, "base64"));
            await shot("html-portada-1440.png");
            await evaluate("document.documentElement.style.scrollBehavior='auto'; document.getElementById('s12').scrollIntoView(); true"); await sleep(400); await shot("html-capitulo12-1440.png");
        }
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(600);
        const overflow = await evaluate("document.documentElement.scrollWidth - window.innerWidth");
        check("Sin desplazamiento horizontal a 390 px", overflow <= 1, `${overflow}px`);
        if (SHOTS) { await evaluate("document.documentElement.style.scrollBehavior='auto'; document.getElementById('s15').scrollIntoView(); true"); await sleep(400); fs.writeFileSync(path.join(SHOTS, "html-capitulo15-390.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64")); }
        ws.close();
    } finally {
        chrome.kill();
        console.log(`Perfil temporal de Chrome (fuera del repositorio): ${work}`);
    }
}

function validateDocx() {
    // Lectura con Python estándar (zipfile) para no depender de bibliotecas adicionales.
    const script = `
import zipfile, re, sys, json
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
bad = z.testzip()
doc = z.read('word/document.xml').decode('utf8')
styles = z.read('word/styles.xml').decode('utf8')
paras = re.findall(r'<w:p[ >].*?</w:p>', doc, re.S)
ids = {m.group(1): m.group(2).lower() for m in re.finditer(r'<w:style [^>]*w:styleId="([^"]+)"[^>]*>.*?<w:name w:val="([^"]+)"', styles, re.S)}
names_map = {"heading 1": "Heading1", "heading 2": "Heading2"}
def style(p):
    m = re.search(r'<w:pStyle w:val="([^"]+)"', p)
    if not m: return ''
    return names_map.get(ids.get(m.group(1), ""), m.group(1))
def text(p): return ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p))
seq = [(style(p), text(p), ('<w:drawing' in p) or ('<w:tbl' in p)) for p in paras]
h1 = [t for s,t,_ in seq if s == 'Heading1']
empty = []
for i,(s,t,_) in enumerate(seq):
    if s in ('Heading1','Heading2'):
        body = 0
        for s2,t2,obj in seq[i+1:]:
            if s2 in ('Heading1','Heading2'): break
            if t2.strip() or obj: body += 1
        if body == 0: empty.append(t)
tables_in_doc = doc.count('<w:tbl>')
print(json.dumps({'zip_ok': bad is None, 'parts': len(names), 'h1': len(h1), 'h1_titles': h1[:3], 'h2': sum(1 for s,_,_ in seq if s=='Heading2'),
  'empty_sections': empty, 'images': len([n for n in names if n.startswith('word/media/') and not n.endswith('/')]), 'dir_entries': len([n for n in names if n.endswith('/')]), 'tables': tables_in_doc,
  'toc': 'TOC \\\\o' in doc or 'TOC \\\\h' in doc or 'w:fldSimple' in doc or 'TOC' in doc,
  'headers': len([n for n in names if re.match(r'word/header\\d+\\.xml', n)]), 'footers': len([n for n in names if re.match(r'word/footer\\d+\\.xml', n)]),
  'page_numbers': 'PAGE' in ''.join(z.read(n).decode('utf8') for n in names if n.startswith('word/footer')),
  'sections': doc.count('<w:sectPr'), 'lang_es': 'es-CO' in styles}, ensure_ascii=False))
`;
    const out = JSON.parse(execFileSync("python", ["-I", "-c", script, DOCX], { encoding: "utf8" }));
    check("DOCX: ZIP íntegro", out.zip_ok, `${out.parts} partes`);
    check("DOCX: Control del documento + 24 capítulos con estilo Título 1", out.h1 === 25, `${out.h1} títulos de nivel 1`);
    check("DOCX: ningún título sin contenido", out.empty_sections.length === 0, out.empty_sections.join(" | ") || `${out.h2} subtítulos de nivel 2 revisados`);
    check("DOCX: imágenes incrustadas", out.images >= 30, `${out.images}`);
    check("DOCX: sin entradas de carpeta en el ZIP", out.dir_entries === 0, `${out.dir_entries}`);
    check("DOCX: tablas", out.tables > 50, `${out.tables}`);
    check("DOCX: tabla de contenido", out.toc, "");
    check("DOCX: encabezados y pies con número de página", out.headers >= 1 && out.footers >= 1 && out.page_numbers, `${out.headers} encabezados, ${out.footers} pies`);
    check("DOCX: secciones (portada, preliminares, cuerpo)", out.sections === 3, `${out.sections}`);
    check("DOCX: idioma español", out.lang_es, "es-CO");
}

(async () => {
    await validateHtml();
    validateDocx();
    for (const r of results) console.log(`${r.ok ? "OK   " : "FALLA"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    if (results.some(r => !r.ok)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
