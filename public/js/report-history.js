// Persisted reports: save the selected PIAR report on the server (which builds
// the snapshot from MySQL), list saved reports and reopen them exactly as they
// were generated. Depends on helpers defined in app.js and api.js.

const DUA_LABELS_FOR_REPORTS = Object.freeze({
    representacion: "Representación",
    accion_expresion: "Acción y expresión",
    implicacion: "Implicación"
});

function reportPiarOptions() {
    return state.piars.map(piar => {
        const student = getStudent(piar.studentId);
        return `<option value="${Number(piar.id)}">${escapeHTML(student ? fullName(student) : "Sin estudiante")} · ${escapeHTML(piar.periodo || "")} · ${escapeHTML(labelStatus(piar.estado))}</option>`;
    }).join("");
}

async function saveCurrentReport() {
    const piarId = Number(document.getElementById("reportPiar")?.value);
    const tipo = document.getElementById("reportType")?.value;
    const periodo = document.getElementById("reportPeriod")?.value || null;
    if (!piarId) return showToastMessage("Selecciona el PIAR del informe que quieres guardar.", "warning");
    try {
        const result = await apiCreate("reports", { id_piar: piarId, tipo, periodo });
        showToastMessage(result.data?.duplicado
            ? "Ese informe ya estaba guardado con el mismo contenido; no se duplicó."
            : "Informe guardado con autor y fecha.");
        await loadSavedReports();
    } catch (error) {
        showToastMessage(error.message, "warning");
    }
}

async function loadSavedReports() {
    const container = document.getElementById("savedReports");
    if (!container) return;
    container.innerHTML = '<p role="status">Cargando informes guardados…</p>';
    try {
        const result = await apiGetReports();
        const rows = result.data || [];
        container.innerHTML = rows.length ? `<div class="responsive-table"><table class="modern-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Estudiante</th><th>Periodo</th><th>Autor</th><th></th></tr></thead>
            <tbody>${rows.map(row => `<tr>
                <td>${escapeHTML(formatVersionDate(row.created_at))}</td>
                <td>${escapeHTML(row.tipo)}</td>
                <td>${escapeHTML(row.estudiante_nombre || "—")}</td>
                <td>${escapeHTML(row.periodo || "—")}</td>
                <td>${escapeHTML(row.autor_nombre || "—")}</td>
                <td><button class="table-btn" type="button" data-onclick="viewSavedReport(${Number(row.id_reporte)})">Ver</button></td>
            </tr>`).join("")}</tbody></table></div>` : emptyState("Aún no hay informes guardados.");
    } catch (error) {
        container.innerHTML = `<p role="alert">${escapeHTML(error.message || "No se pudieron cargar los informes guardados.")}</p>`;
    }
}

async function viewSavedReport(reportId) {
    try {
        const result = await apiRequest(`reports/${Number(reportId)}`, "GET");
        const report = result.data;
        if (!report.contenido) return showToastMessage("Este informe no tiene contenido guardado.", "warning");
        openModal(`Informe guardado · ${report.tipo}`, `
            <div class="piar-detail">
                <div class="piar-actions no-print"><button class="table-btn" type="button" data-onclick="printPiarDetail()">Imprimir / Guardar PDF</button></div>
                <p><strong>Generado:</strong> ${escapeHTML(formatVersionDate(report.created_at))} · <strong>Autor:</strong> ${escapeHTML(report.autor_nombre || "—")}</p>
                ${renderReportSnapshot(report.contenido)}
            </div>`);
    } catch (error) {
        showToastMessage(error.message, "warning");
    }
}

function renderReportSnapshot(content) {
    const piar = content.piar || {};
    const student = content.estudiante || {};
    const section = (title, items, render) => `<h3 class="section-title">${escapeHTML(title)}</h3>${(items || []).map(render).join("") || emptyState("Sin registros.")}`;
    return `
        <h2>${escapeHTML(student.nombre || "Estudiante")}</h2>
        <p>${escapeHTML(piar.titulo || "")} · ${escapeHTML(content.periodo || piar.periodo || "")} · ${escapeHTML(labelStatus(piar.estado || ""))}</p>
        <div class="profile-info">
            ${infoCard("Grado", student.curso)}
            ${infoCard("Condición", student.condicion_especial)}
            ${infoCard("Objetivo general", piar.objetivo_general)}
            ${infoCard("Metas", piar.metas)}
            ${infoCard("Estrategias de aula", piar.estrategias)}
            ${infoCard("Docentes", (content.docentes || []).map(item => item.nombre).join(", "))}
        </div>
        ${section("Barreras", content.barreras, item => `<div class="info-card wide-info"><h4>${escapeHTML(item.contexto)}</h4><p>${escapeHTML(item.descripcion)}</p></div>`)}
        ${section("Ajustes razonables", content.ajustes, item => `<div class="info-card wide-info"><h4>${escapeHTML(item.area)} · ${escapeHTML(item.tipo)}</h4><p>${escapeHTML(item.estrategia)}</p>${item.resultado_esperado ? `<p><strong>Resultado esperado:</strong> ${escapeHTML(item.resultado_esperado)}</p>` : ""}<p><strong>Evidencias:</strong> ${(item.evidencias || []).length}</p></div>`)}
        ${section("DUA", content.dua, item => `<div class="info-card wide-info"><h4>${escapeHTML(DUA_LABELS_FOR_REPORTS[item.principio] || item.principio)}</h4><p>${escapeHTML(item.estrategia)}</p></div>`)}
        ${section("Seguimientos", content.seguimientos, item => `<div class="info-card wide-info"><h4>${escapeHTML(String(item.fecha || "").slice(0, 10))}</h4><p>${escapeHTML(item.descripcion)}</p></div>`)}
        ${section("Observaciones", content.observaciones, item => `<div class="info-card wide-info"><h4>${escapeHTML(String(item.fecha || "").slice(0, 10))} · ${escapeHTML(item.tipo || "")}</h4><p>${escapeHTML(item.descripcion)}</p></div>`)}`;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderReportSnapshot };
}
