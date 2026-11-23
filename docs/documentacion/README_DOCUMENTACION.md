# Documentación integral del Sistema PIAR

Generada el 22 de noviembre de 2026 a partir del commit `6158d9a`. Esta carpeta contiene el entregable final en dos formatos con el mismo contenido, sus fuentes en Markdown, los diagramas y las herramientas para regenerarlo.

## 1. Entregables

| Archivo | Descripción |
|---|---|
| `ENTREGABLE_FINAL_PIAR.html` | Versión web en un solo archivo (imágenes incrustadas). Conserva la estructura y la identidad visual de la plantilla institucional: menú lateral, portada, tarjetas, tablas y colores. Funciona sin conexión |
| `ENTREGABLE_FINAL_PIAR.docx` | Versión Word editable: portada, tabla de contenido automática, estilos de título (niveles 1 a 3), numeración de páginas (romana en los preliminares y arábiga en el cuerpo), encabezados y pies, tablas, figuras numeradas, márgenes de 1" en tamaño carta, fuente Arial 11 e idioma español (Colombia) |

## 2. Organización

```text
docs/documentacion/
├── ENTREGABLE_FINAL_PIAR.html
├── ENTREGABLE_FINAL_PIAR.docx
├── README_DOCUMENTACION.md        este archivo
├── capitulos/                     24 capítulos en Markdown (fuente única de ambos formatos)
├── diagramas/
│   ├── fuente/                    19 diagramas Mermaid (.mmd)
│   ├── png/                       los mismos diagramas en PNG (escala 2)
│   └── svg/                       los mismos diagramas en SVG
├── recursos/
│   ├── capturas/                  15 capturas de la demo (datos sintéticos) en JPEG
│   └── plantilla-estilos.css      estilos extraídos de la plantilla (solo lectura)
└── herramientas/                  scripts de generación y validación
```

## 3. Registro de capítulos

| # | Capítulo | Archivo | Fuentes principales | Estado |
|---|---|---|---|---|
| 1 | Presentación | `01_presentacion.md` | `README.md`, historial de Git | Completo |
| 2 | Problema | `02_problema.md` | Decreto 1421 de 2017, `docs/PIAR-DOC-01` | Completo |
| 3 | Justificación | `03_justificacion.md` | Código, `npm audit` | Completo |
| 4 | Objetivos | `04_objetivos.md` | Código y pruebas | Completo |
| 5 | Alcance y limitaciones | `05_alcance.md` | `docs/ESTADO_FINAL_PROYECTO.md` | Completo |
| 6 | Requisitos | `06_requisitos.md` | `backend/server.js`, `authorization.js` | Completo |
| 7 | Historias y casos de uso | `07_historias_casos_uso.md` | Pruebas e2e, manual de usuario | Completo |
| 8 | Arquitectura | `08_arquitectura.md` | `backend/`, `public/`, `package.json`, `Dockerfile` | Completo |
| 9 | UML y procesos | `09_uml_procesos.md` | `auth.js`, `event-actions.js`, `piar-versioning.js` | Completo |
| 10 | Modelo ER | `10_modelo_er.md` | Esquema migrado (estructura) | Completo |
| 11 | Diccionario de datos | `11_diccionario_datos.md` | Generado desde `information_schema` | Completo (generado) |
| 12 | Módulos | `12_modulos.md` | Código y capturas de la demo | Completo |
| 13 | Manual técnico | `13_manual_tecnico.md` | `docs/MANUAL_TECNICO_PIAR.md` | Completo |
| 14 | Manual de usuario | `14_manual_usuario.md` | `docs/MANUAL_USUARIO.md` | Completo |
| 15 | Roles y permisos | `15_roles_permisos.md` | `backend/authorization.js` | Completo |
| 16 | Seguridad | `16_seguridad.md` | Código y verificaciones en producción | Completo |
| 17 | API | `17_api.md` | `backend/server.js` | Completo |
| 18 | Pruebas | `18_pruebas.md` | `docs/MATRIZ_PRUEBAS_PIAR.md`, ejecución del 22 nov 2026 | Completo |
| 19 | Despliegue | `19_despliegue.md` | `docs/DESPLIEGUE_RAILWAY.md`, `Dockerfile` | Completo |
| 20 | Mantenimiento | `20_mantenimiento.md` | `docs/GUIA_MYSQL_MIGRACIONES.md` | Completo |
| 21 | Limitaciones y pendientes | `21_limitaciones_pendientes.md` | `docs/PROCEDIMIENTOS_PENDIENTES.md` | Completo |
| 22 | Glosario | `22_glosario.md` | — | Completo |
| 23 | Conclusiones | `23_conclusiones.md` | — | Completo |
| 24 | Referencias | `24_referencias.md` | Normas y documentación oficial | Completo |

**Datos por completar en la portada:** número de ficha y nombres del equipo.

## 4. Diagramas

| Archivo | Contenido | Usado en |
|---|---|---|
| `01_contexto` | Diagrama de contexto | Cap. 8 |
| `02_arquitectura_capas` | Arquitectura en capas | Cap. 8 |
| `03_componentes_backend` | Componentes del backend | Cap. 8 |
| `04_despliegue_railway` | Despliegue en Railway | Cap. 8 |
| `05_casos_uso_gestion`, `06_casos_uso_pedagogico` | Casos de uso | Cap. 7 |
| `07_secuencia_autenticacion` | Secuencia del inicio de sesión | Cap. 9 |
| `08_flujo_registro_aprobacion` | Registro y aprobación | Cap. 9 |
| `09_flujo_piar` | Ciclo de vida del PIAR | Cap. 9 |
| `10_navegacion` | Mapa de navegación | Cap. 9 |
| `11_eps` | Entrada–proceso–salida | Cap. 2 |
| `12_cronograma` | Cronograma (Gantt) | Cap. 1 |
| `13a_er_nucleo_piar`, `13b_er_registros`, `13c_er_historial_reportes` | Modelo ER pedagógico por vistas | Cap. 10 |
| `14a_er_credenciales`, `14b_er_vinculos_auditoria` | Modelo ER de cuentas y auditoría | Cap. 10 |
| `13_er_pedagogico`, `14_er_cuentas_seguridad` | Vistas completas en un solo diagrama (consulta) | Recurso |

Los diagramas ER y el capítulo 11 se generan desde la estructura del esquema; los demás se escribieron a partir del código.

## 5. Cómo regenerar

Requisitos: Node.js 22, Google Chrome, Python 3 y, para el paso 4, Microsoft Word. Las bibliotecas `marked`, `docx` y `mermaid` se instalan **fuera del repositorio** para no modificar `package.json`:

```bash
mkdir <carpeta-temporal> && cd <carpeta-temporal> && npm init -y && npm install docx@9 marked@15 mermaid@11
```

1. **Diccionario y diagramas ER** (solo si cambió el esquema). Se necesitan cuatro archivos TSV con la estructura de un esquema migrado (`information_schema.COLUMNS`, `KEY_COLUMN_USAGE`, `STATISTICS` y `TABLES`), obtenidos con consultas de solo lectura sobre una base de ensayo, nunca sobre producción:
   `node herramientas/generar-modelo-datos.js <carpeta-tsv> .`
2. **Imágenes:** `node herramientas/renderizar-recursos.js <carpeta-temporal>/node_modules/mermaid/dist/mermaid.min.js`
3. **HTML y DOCX:** `node herramientas/construir-entregable.js <carpeta-temporal>/node_modules ["<ruta de la plantilla HTML>"]`. Si se indica la plantilla, se vuelven a extraer sus estilos; la plantilla solo se lee.
4. **Índice de Word:** `powershell -File herramientas/actualizar-word.ps1 [-Pdf <ruta>]` abre el DOCX en Word, actualiza la tabla de contenido y lo guarda.
5. **Validación:** `node herramientas/validar-entregable.js [<carpeta de capturas>]`.

## 6. Reglas aplicadas

- No se modificó el código del sistema, la base de datos, Railway ni ninguna cuenta.
- No se incluyen contraseñas, tokens, claves, hashes ni datos personales de estudiantes. Las capturas usan datos sintéticos.
- La plantilla original (`1. entregablefinal.html`) no se modificó: su SHA-256 empieza por `13b0967701bb4927` antes y después de la generación.
- Cada afirmación lleva su estado: implementado, probado localmente, verificado en producción o pendiente.
- Los documentos anteriores de `docs/` se conservan sin cambios. Las contradicciones encontradas están en el capítulo 21.4.
