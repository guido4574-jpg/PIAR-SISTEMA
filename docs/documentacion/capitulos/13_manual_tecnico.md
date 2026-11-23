# 13. Manual técnico

<!-- sub: Instalación, estructura del código, configuración y operación -->

## 13.1 Requisitos previos

Tabla: Software necesario para desarrollo

| Software | Versión | Uso |
|---|---|---|
| Node.js | 22.x (el `package.json` exige `>=22 <23`) | Ejecutar el servidor y las pruebas |
| npm | 10.x | Instalar dependencias |
| MySQL | 8.0 o superior | Base de datos (en local, contenedor en el puerto 3307) |
| Docker Desktop | Opcional | Contenedor de MySQL de pruebas e imagen de producción |
| Git | Cualquier versión reciente | Control de versiones |
| Google Chrome | Reciente | Revisión de la interfaz |

Tabla: Hardware mínimo de referencia

| Recurso | Desarrollo | Servidor de producción |
|---|---|---|
| Procesador | 2 núcleos | Lo asigna Railway |
| Memoria RAM | 4 GB (el equipo de desarrollo tiene 3,9 GB y obliga a ejecutar las pruebas de forma secuencial) | La asigna Railway según el plan |
| Disco | 2 GB libres | Volumen persistente para MySQL |
| Red | Conexión a Internet para las dependencias y la CDN | HTTPS público |

## 13.2 Estructura del repositorio

```text
PIAR-SISTEMA/
├── backend/              37 módulos del servidor (server.js es el punto de entrada)
├── public/               Interfaz: index.html, css/, js/ (12 archivos), fuentes
├── database/migrations/  Migraciones 000–016 (no existe la 004)
├── scripts/              Herramientas: verificación, traslado de la Administradora,
│                         pruebas locales, respaldos, demo visual, detector de secretos
├── tests/                47 archivos: 44 unitarios, integración y e2e
├── docs/                 Documentación vigente, histórica y evidencias
├── Dockerfile            Imagen de producción (node:22-alpine, usuario node)
├── railway.json          Configuración de Railway (formato en retiro)
└── package.json          Dependencias y comandos npm
```

## 13.3 Instalación local

1. Clonar el repositorio y entrar en la carpeta.
2. Instalar las dependencias exactas: `npm ci`.
3. Ejecutar las pruebas unitarias, que no necesitan base de datos: `npm test`.
4. Para ver la interfaz sin base de datos: `npm run demo:visual` y abrir `http://127.0.0.1:4173`.
5. Para usar MySQL local:
   - levantar el contenedor de pruebas (`docker-compose.test.yml`, puerto 3307);
   - aplicar las migraciones: `npm run db:migrate` (solo acepta esquemas `piar_dev*` o `piar_test*` en el equipo local);
   - arrancar el backend: `node scripts/start-local-backend.js` (escucha en `127.0.0.1:8090` y toma las credenciales de `.env.test` sin imprimirlas).

> **Atención:** el archivo `.env` local apunta a `127.0.0.1:3306` sin `DB_USER`, por lo que `npm start` no conecta. Use `scripts/start-local-backend.js`.

## 13.4 Variables de entorno

Tabla: Variables de entorno principales

| Variable | Descripción | Ejemplo o valor en producción |
|---|---|---|
| `NODE_ENV` | Activa las validaciones de producción, `Secure` en la cookie y HSTS | `production` |
| `HOST`, `PORT` | Dirección y puerto de escucha; los fija el `Dockerfile` | `0.0.0.0`, `8080` |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Conexión a MySQL | Red privada de Railway, `piar_produccion` |
| `DB_USER`, `DB_PASSWORD` | Cuenta de la aplicación (nunca `root`) | `piar_app`; la contraseña solo existe en el panel de Railway |
| `DB_SSL` | TLS hacia MySQL | Según la conexión |
| `DB_CONNECTION_LIMIT` | Tamaño del grupo de conexiones | `10` |
| `APP_BASE_URL`, `CORS_ORIGIN` | URL pública y orígenes permitidos para escrituras | El dominio de Railway |
| `RATE_LIMIT_STORE` | Almacén de límites de intentos (`memory` o `mysql`) | `mysql` |
| `TRUSTED_PROXIES` | Redes de proxy de confianza para leer la IP real | Pendiente de ajuste (capítulo 21) |
| `MAINTENANCE_INTERVAL_MINUTES` | Frecuencia de la purga de registros vencidos | `60` |
| `SECURITY_EVENT_RETENTION_DAYS` | Retención de eventos de seguridad | `365` |
| `EMAIL_TRANSPORT` | `resend`, `smtp`, `api`, `memory` o `desactivado` | `desactivado` |
| `EMAIL_FROM`, `EMAIL_FROM_NAME`, `RESEND_API_KEY` | Remitente y clave de Resend | Pendientes |

> **Importante:** los valores secretos (contraseñas y claves) nunca se versionan ni se incluyen en esta documentación. `npm run check:secrets` revisa que no lleguen al repositorio.

## 13.5 Comandos de operación

Tabla: Comandos npm disponibles

| Comando | Función |
|---|---|
| `npm start` | Arranca el servidor (`backend/server.js`) |
| `npm run dev` | Arranca con recarga automática |
| `npm test` | 44 archivos de pruebas unitarias, de forma secuencial |
| `npm run test:integration:local` | Pruebas de integración con MySQL real |
| `npm run test:e2e` | Flujos completos por rol |
| `npm run check:secrets` | Detector de secretos y datos sensibles |
| `npm run db:migrate` / `db:migrate:status` | Migraciones locales |
| `npm run db:migrate:remote` / `db:migrate:remote:status` | Migraciones remotas con confirmación del esquema |
| `npm run db:verificar` | Verificación de solo lectura: TLS, privilegios, 28 tablas, 16 migraciones y huella de la Administradora |
| `npm run correo:probar` | Prueba del transporte de correo configurado |
| `npm run db:purge-expired` | Purga manual de tokens y sesiones vencidos |

## 13.6 Cómo agregar funcionalidades

**Nueva ruta de la API:**

1. Declarar el permiso por rol en `backend/authorization.js` (sin permiso, la ruta se deniega).
2. Implementar el manejador en `server.js`, o en un módulo nuevo si la lógica es extensa.
3. Usar consultas parametrizadas y validar la entrada en el servidor.
4. Agregar pruebas en `tests/`.

**Nueva acción en la interfaz:**

1. Declarar la función en el ámbito global de un archivo de `public/js/`.
2. Usar `data-onclick`, `data-onsubmit`, `data-oninput` o `data-onchange` en la plantilla.
3. Añadir el nombre a la lista `PIAR_EVENT_ACTIONS`.

**Cambio de esquema:** crear una migración nueva con el siguiente número. Nunca se edita una migración aplicada, porque su checksum ya está registrado.

## 13.7 Convenciones de código

- JavaScript con `"use strict"` en el backend, cuatro espacios de sangría y comillas dobles.
- Nombres de funciones y variables en inglés en el código y nombres de tablas y columnas en español, herencia del modelo inicial.
- Mensajes para las personas usuarias, documentación y mensajes de commit en español.
- Commits organizados por área (`seguridad:`, `bd:`, `backend:`, `frontend:`, `pruebas:`, `despliegue:`, `docs:`, `correo:`).
