# PIAR-SISTEMA

Aplicación web para gestionar el Plan Individual de Ajustes Razonables (PIAR/PR) del Colegio Reinaldo Matiz. Gestiona:
- estudiantes y docentes;
- diagnósticos, barreras, ajustes razonables con evidencias y DUA;
- observaciones, seguimientos, versiones, reportes;
- cuentas con seis roles: Administrador, Rector, Coordinador, Psicólogo(a), Docente y Estudiante.

Tecnología: Node.js 22 (`http` nativo), MySQL 8 (`mysql2`), HTML, CSS y JavaScript sin frameworks, Chart.js.

## Documentación

| Tema | Documento |
|---|---|
| Estado final, pendientes y autorizaciones | `docs/ESTADO_FINAL_PROYECTO.md` |
| Procedimientos pendientes paso a paso | `docs/PROCEDIMIENTOS_PENDIENTES.md` |
| Decisiones vigentes (D1–D8) | `docs/DECISIONES_TECNICAS.md` |
| Manual técnico (arquitectura, permisos, seguridad) | `docs/MANUAL_TECNICO_PIAR.md` |
| Manual de usuario | `docs/MANUAL_USUARIO.md` |
| MySQL, migraciones, respaldo | `docs/GUIA_MYSQL_MIGRACIONES.md` |
| Puesta en producción en Railway | `docs/DESPLIEGUE_RAILWAY.md` |
| Pruebas y resultados | `docs/MATRIZ_PRUEBAS_PIAR.md` |
| Índice completo (vigente e histórico) | `docs/README.md` |

## Estructura

```text
backend/      Servidor HTTP y API
database/     Migraciones SQL versionadas (000–016)
docs/         Manuales, guías e informes
public/       Interfaz (HTML, CSS, JavaScript, fuentes)
scripts/      Herramientas locales: demo visual, integración, traslado de la Administradora
tests/        Pruebas unitarias, integración y e2e
Dockerfile, railway.json   Imagen y despliegue de producción
```

## Instalación local

Requisitos: Node.js 22 y Docker Desktop con el contenedor `piar-mysql-test` (MySQL 8 en `127.0.0.1:3307`, base `piar_test`).

```bash
npm install
node scripts/start-local-backend.js      # http://127.0.0.1:8090 sobre piar_test
npm run demo:visual                      # http://127.0.0.1:4173, interfaz sin base de datos
```

`start-local-backend.js` toma `DB_USER` y `DB_PASSWORD` de `.env.test` sin imprimirlos, y solo admite `piar_test` o `piar_test_*`.

**Para otra base local:**
1. Copia `.env.example` a `.env`.
2. Define `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`, con una cuenta solo DML (nunca `root` ni el esquema `piar`).
3. Ejecuta `npm start`.

La aplicación no migra al arrancar; las migraciones se explican en `docs/GUIA_MYSQL_MIGRACIONES.md`.

## Comandos

| Comando | Uso |
|---|---|
| `npm test` | Pruebas unitarias (sin MySQL) |
| `npm run test:e2e` | Flujos completos contra un esquema desechable (`PIAR_E2E_DB_*`) |
| `npm run test:integration:local` / `node scripts/run-local-integration-test.js ensayo` | Integración HTTP y SQL (`piar_test`, o una copia `piar_test_ensayo_*`) |
| `npm run check:secrets` | Detector de secretos y datos sensibles (archivos versionados y por agregar) |
| `npm run db:migrate[:status]` | Migraciones en bases locales de prueba |
| `npm run db:migrate:remote[:status]` | Migraciones en la base remota (requiere confirmación) |
| `node scripts/admin-transfer.js` | Traslado controlado de la cuenta Administradora principal |
| `npm run db:verificar` | Verificación de solo lectura de una base (producción o ensayo) |
| `npm run correo:probar -- --verificar` | Comprobación del correo configurado, sin enviar |

## Seguridad

- **Nunca** subas `.env`, `.env.test`, volcados ni paquetes de traslado.
- El servidor rechaza en producción una configuración insegura (http, localhost, correo en memoria, esquema de pruebas).
- La matriz de permisos se aplica en el backend (`backend/authorization.js`).
