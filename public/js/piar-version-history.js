(function exposePiarVersionHistory(global) {
    const fields = {
        piar: ["titulo", "periodo", "anio", "estado", "objetivo_general", "metas", "caracterizacion", "barreras", "estrategias", "proyectos", "actividades_receso", "otra_informacion", "acta_acuerdos", "informe_anual", "entrega_pedagogica", "fecha_revision", "fecha_cierre"],
        docentes: ["id_docente", "nombre", "area", "cargo", "es_responsable_principal"],
        ajustes: ["id_ajuste", "area", "tipo", "estrategia", "recursos", "responsable", "resultado_esperado", "indicador_logro", "fecha_revision_prevista", "avance", "estado"],
        evidencias: ["id_evidencia", "descripcion", "fecha"],
        barreras: ["id_barrera", "contexto", "descripcion", "actividad", "condicion_entorno", "fecha_identificacion"],
        seguimientos: ["id_seguimiento", "fecha", "descripcion", "estado", "acuerdos", "evolucion"],
        observaciones: ["id_observacion", "fecha", "tipo", "avance", "estado", "descripcion", "acuerdos"]
    };

    function pick(record, allowed) {
        if (!record || typeof record !== "object") return record;
        return Object.fromEntries(allowed.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]]));
    }

    function projectSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== "object") return {};
        const output = {};
        if (snapshot.piar) output.piar = pick(snapshot.piar, fields.piar);
        if (Array.isArray(snapshot.docentes)) output.docentes = snapshot.docentes.map(row => pick(row, fields.docentes));
        if (Array.isArray(snapshot.ajustes)) output.ajustes = snapshot.ajustes.map(row => ({
            ...pick(row, fields.ajustes),
            ...(Array.isArray(row.evidencias) ? { evidencias: row.evidencias.map(evidence => pick(evidence, fields.evidencias)) } : {})
        }));
        for (const collection of ["barreras", "seguimientos", "observaciones"]) {
            if (Array.isArray(snapshot[collection])) output[collection] = snapshot[collection].map(row => pick(row, fields[collection]));
        }
        return output;
    }

    function flatten(value, path = "", output = {}) {
        if (Array.isArray(value)) {
            const idField = value.length ? Object.keys(value[0]).find(key => /^id_(?:docente|ajuste|evidencia|barrera|seguimiento|observacion)$/.test(key)) : null;
            value.forEach((item, index) => flatten(item, `${path}[${idField && item[idField] != null ? item[idField] : index}]`, output));
        } else if (value && typeof value === "object") {
            for (const [key, child] of Object.entries(value)) flatten(child, path ? `${path}.${key}` : key, output);
        } else if (path) {
            output[path] = value === null || value === undefined ? "" : String(value);
        }
        return output;
    }

    function compareSnapshots(before, after) {
        const left = flatten(projectSnapshot(before));
        const right = flatten(projectSnapshot(after));
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
        return keys.flatMap(path => {
            const had = Object.hasOwn(left, path);
            const has = Object.hasOwn(right, path);
            if (had && has && left[path] === right[path]) return [];
            return [{ path, kind: !had ? "added" : !has ? "removed" : "modified", before: had ? left[path] : "", after: has ? right[path] : "" }];
        });
    }

    function formatOperation(value) {
        const operation = String(value || "").replace(/^piar_version:/, "").replace(/_/g, " ").trim();
        return operation || "Actualización";
    }

    async function loadVersions(piarId, listVersions) {
        const result = await listVersions(Number(piarId));
        if (!Array.isArray(result?.data)) throw new Error("La respuesta del historial no tiene un formato válido.");
        return result.data;
    }

    async function getComparison(piarId, firstId, secondId, getVersion) {
        const leftId = Number(firstId);
        const rightId = Number(secondId);
        if (!Number.isSafeInteger(leftId) || !Number.isSafeInteger(rightId) || leftId <= 0 || rightId <= 0 || leftId === rightId) {
            throw new Error("Selecciona dos versiones diferentes para comparar.");
        }
        const [left, right] = await Promise.all([
            getVersion(Number(piarId), leftId),
            getVersion(Number(piarId), rightId)
        ]);
        if (!left?.data || !right?.data) throw new Error("No se pudieron recuperar ambas versiones.");
        return { left: left.data, right: right.data, changes: compareSnapshots(left.data.valor_nuevo, right.data.valor_nuevo) };
    }

    const api = { projectSnapshot, flatten, compareSnapshots, formatOperation, loadVersions, getComparison };
    global.PiarVersionHistory = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
