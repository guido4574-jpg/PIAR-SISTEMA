"use strict";

// Renderiza los diagramas Mermaid (diagramas/fuente/*.mmd) a SVG y PNG, y genera copias JPEG livianas
// de las capturas de evidencia para incrustarlas en el HTML y en el DOCX.
// Usa Chrome sin interfaz mediante el protocolo DevTools; no abre puertos públicos ni modifica la aplicación.
// Uso: node renderizar-recursos.js <ruta a mermaid.min.js>
//   (mermaid se instala fuera del repositorio, p. ej. npm install mermaid@11 en una carpeta temporal)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DOCS = path.resolve(__dirname, "..");
const CAPTURAS = path.resolve(DOCS, "..", "evidencias", "bitacora", "capturas");
const MERMAID = path.resolve(process.argv[2] || "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9341;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Capturas actuales (la demo usa datos sintéticos). Las de «diseño previo» se excluyen.
const CAPTURAS_USADAS = ["01-inicio-sesion", "02-registro-docente", "03a-dashboard-administrador", "03c-nueva-observacion", "04a-estudiantes", "04b-nuevo-estudiante", "05-docentes", "06-piar-listado-docente", "06b-nuevo-piar", "07a-documento-piar", "08-registro-barrera", "09a-reportes", "09b-reporte-impresion", "10a-solicitudes", "10b-usuarios"];

async function main() {
    if (!fs.existsSync(MERMAID)) throw new Error("Indique la ruta de mermaid.min.js como primer argumento.");
    const fuente = path.join(DOCS, "diagramas", "fuente");
    const defs = fs.readdirSync(fuente).filter(f => f.endsWith(".mmd")).sort().map(f => ({ name: f.replace(/\.mmd$/, ""), code: fs.readFileSync(path.join(fuente, f), "utf8") }));
    fs.mkdirSync(path.join(DOCS, "diagramas", "png"), { recursive: true });
    fs.mkdirSync(path.join(DOCS, "diagramas", "svg"), { recursive: true });
    fs.mkdirSync(path.join(DOCS, "recursos", "capturas"), { recursive: true });

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "piar-render-"));
    const page = path.join(work, "render.html");
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:'Segoe UI',Arial,sans-serif}#out>div{display:inline-block;padding:16px;background:#fff}</style><div id="out"></div><script src="${pathToFileURL(MERMAID).href}"></script>`);

    const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(work, "perfil")}`, "--no-first-run", "--disable-gpu", "--disable-extensions", "--allow-file-access-from-files", "--window-size=1600,1200", "about:blank"], { stdio: "ignore" });
    try {
        let targets = [];
        for (let i = 0; i < 60 && !targets.length; i += 1) {
            try { targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(t => t.type === "page"); } catch { /* Chrome aún no responde */ }
            if (!targets.length) await sleep(250);
        }
        const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
        await new Promise(resolve => ws.addEventListener("open", resolve));
        let seq = 0;
        const pending = new Map();
        ws.addEventListener("message", event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
        const send = (method, params = {}) => new Promise(resolve => { seq += 1; pending.set(seq, resolve); ws.send(JSON.stringify({ id: seq, method, params })); });
        const evaluate = async expression => {
            const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
            return r.result.result.value;
        };

        await send("Page.enable");
        await send("Page.navigate", { url: pathToFileURL(page).href });
        for (let i = 0; i < 40 && !(await evaluate("typeof mermaid !== 'undefined'")); i += 1) await sleep(250);
        await evaluate(`mermaid.initialize({ startOnLoad:false, theme:'base', securityLevel:'strict', fontFamily:"'Segoe UI', Arial, sans-serif",
            themeVariables:{ primaryColor:'#E8F5DF', primaryBorderColor:'#39A900', primaryTextColor:'#1E2A16', lineColor:'#1E5C00', secondaryColor:'#FFF3E0', tertiaryColor:'#F7FAF5', clusterBkg:'#F7FAF5', clusterBorder:'#9CCB7E', fontSize:'15px', actorBkg:'#E8F5DF', actorBorder:'#39A900', noteBkgColor:'#FFF3E0' },
            flowchart:{ useMaxWidth:false, htmlLabels:false, curve:'basis', nodeSpacing:36, rankSpacing:48 }, sequence:{ useMaxWidth:false }, er:{ useMaxWidth:false }, gantt:{ useMaxWidth:false, useWidth:1000, fontSize:13, sectionFontSize:14 } }); true`);

        const informe = [];
        for (const def of defs) {
            const svg = await evaluate(`(async () => { const r = await mermaid.render('d_${def.name}', ${JSON.stringify(def.code)}); const box = document.getElementById('out'); box.innerHTML = '<div>' + r.svg + '</div>'; return r.svg; })()`);
            fs.writeFileSync(path.join(DOCS, "diagramas", "svg", `${def.name}.svg`), svg);
            const rect = await evaluate("(() => { const r = document.querySelector('#out > div').getBoundingClientRect(); return { x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()");
            // Escala 2 para nitidez; los diagramas muy grandes se capturan a escala menor si Chrome no tiene memoria suficiente.
            let shot;
            for (const scale of [2, 1.5, 1]) {
                await send("Emulation.setDeviceMetricsOverride", { width: Math.max(1600, rect.width + 40), height: Math.max(1200, rect.height + 40), deviceScaleFactor: scale, mobile: false });
                await sleep(300);
                shot = await send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 }, captureBeyondViewport: true });
                if (shot.result) break;
            }
            if (!shot.result) { informe.push(`${def.name}: CAPTURA FALLIDA (${shot.error?.message}); se conserva el PNG anterior`); continue; }
            fs.writeFileSync(path.join(DOCS, "diagramas", "png", `${def.name}.png`), Buffer.from(shot.result.data, "base64"));
            informe.push(`${def.name}: ${rect.width}×${rect.height}`);
        }

        // Capturas: copia JPEG de ancho máximo 1400 px para que el HTML incrustado y el DOCX pesen menos.
        await send("Emulation.clearDeviceMetricsOverride");
        for (const name of CAPTURAS_USADAS) {
            const src = path.join(CAPTURAS, `${name}.png`);
            if (!fs.existsSync(src)) { informe.push(`${name}: NO ENCONTRADA`); continue; }
            const b64 = fs.readFileSync(src).toString("base64");
            const out = await evaluate(`new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { const s = Math.min(1, 1400 / img.naturalWidth); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); resolve({ data: c.toDataURL('image/jpeg', 0.84).split(',')[1], w: c.width, h: c.height }); }; img.onerror = () => reject(new Error('imagen inválida')); img.src = 'data:image/png;base64,${b64}'; })`);
            fs.writeFileSync(path.join(DOCS, "recursos", "capturas", `${name}.jpg`), Buffer.from(out.data, "base64"));
            informe.push(`${name}.jpg: ${out.w}×${out.h}`);
        }
        ws.close();
        console.log(informe.join("\n"));
    } finally {
        chrome.kill();
        // El perfil temporal queda en la carpeta temporal del sistema (fuera del repositorio); no se borra nada.
        console.log(`Perfil temporal de Chrome: ${work}`);
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
