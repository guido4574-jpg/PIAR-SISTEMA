# 19. Manual de despliegue

<!-- sub: Cómo se publicó el sistema en Railway y cómo repetirlo -->

## 19.1 Entorno de producción actual

Tabla: Estado del entorno publicado

| Elemento | Valor | Estado |
|---|---|---|
| Plataforma | Railway, plan Trial, entorno `production` | [PRODUCCIÓN] |
| Servicios | `PIAR-SISTEMA` (aplicación) y `MySQL` (8.4.13, volumen persistente) | [PRODUCCIÓN] |
| URL | https://piar-sistema-production-99f3618b.up.railway.app | [PRODUCCIÓN] |
| Código | Rama `main`, commit `6158d9a`, despliegue `95d15fdd` | [PRODUCCIÓN] |
| Esquema | `piar_produccion`: 28 tablas, 16 migraciones | [PRODUCCIÓN] |
| Cuentas MySQL | `piar_app` (solo DML, usada por la aplicación) y `piar_migrador` (bloqueada) | [PRODUCCIÓN] |
| Correo | `EMAIL_TRANSPORT=desactivado` | [PENDIENTE] de proveedor |
| Verificación de salud | `railway.json` define `/api/health`, pero Railway no la aplicó (`healthcheckPath` vacío) | [PENDIENTE] configurarla en el panel |

## 19.2 Imagen de la aplicación

El `Dockerfile` construye la imagen con `node:22-alpine`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend ./backend
COPY public ./public
COPY database/migrations ./database/migrations
COPY scripts/verificar-produccion.js scripts/probar-correo.js scripts/admin-transfer.js ./scripts/
USER node
EXPOSE 8080
CMD ["node", "backend/server.js"]
```

La imagen solo instala dependencias de producción, se ejecuta con el usuario sin privilegios `node` e incluye las tres herramientas de operación: verificador, probador de correo y traslado de la Administradora.

## 19.3 Secuencia de puesta en producción

La secuencia ejecutada el 22 de noviembre de 2026, con autorización expresa en cada paso, fue:

1. **Respaldo** de MySQL antes de cualquier cambio, verificado con su suma SHA-256.
2. **Creación del esquema** `piar_produccion` y de las cuentas `piar_app` (DML) y `piar_migrador` (DDL), con contraseñas generadas y guardadas fuera del repositorio.
3. **Migraciones remotas:** `npm run db:migrate:remote` con `PIAR_MIGRATION_CONFIRM_DATABASE=piar_produccion` y la cuenta de migración. El ejecutor rechaza la conexión local, el esquema `piar` y los esquemas de pruebas, y usa `GET_LOCK` para evitar ejecuciones simultáneas.
4. **Verificación:** `npm run db:verificar` (28 tablas, 16 migraciones).
5. **Traslado de la Administradora 178** con `scripts/admin-transfer.js`: exporta un paquete con la fila exacta y su huella SHA-256, lo importa con confirmación y comprueba la huella en el destino.
6. **Bloqueo** de `piar_migrador` al terminar.
7. **Variables** del servicio en el panel de Railway (los secretos solo existen allí).
8. **Publicación** de la rama en GitHub y despliegue automático desde `main`.
9. **Verificaciones posteriores** (capítulo 18.4).

> **Importante:** no se copiaron datos sintéticos de prueba a producción. La única cuenta en `piar_produccion` es la Administradora trasladada.

## 19.4 Variables del servicio

Las variables y su significado están en el capítulo 13.4. En producción se cumplen estas reglas:

- `DB_USER` es `piar_app`, nunca la cuenta `root` que Railway ofrece por defecto.
- `APP_BASE_URL` y `CORS_ORIGIN` usan el dominio HTTPS público.
- `RATE_LIMIT_STORE=mysql`, para que los límites sobrevivan a los redespliegues.
- No se definen `HOST` ni `PORT` (los fija el `Dockerfile`), ni variables de OIDC o del buzón de desarrollo.

## 19.5 Activar el correo con Resend

Railway bloquea el SMTP saliente en los planes Free, Trial y Hobby. Por eso se implementó Resend, que funciona por API HTTPS (decisión D9). Pasos pendientes:

1. Crear la cuenta institucional en Resend y verificar un dominio o subdominio propio.
2. Crear una clave con permiso **Sending access**.
3. En Railway, definir `EMAIL_TRANSPORT=resend`, `EMAIL_FROM` (dirección del dominio verificado), `EMAIL_FROM_NAME` y `RESEND_API_KEY` (cargada con `--stdin`, nunca en la línea de comandos).
4. Comprobar con `npm run correo:probar -- --verificar` y, con autorización, enviar una prueba real.

> **Atención:** con el remitente `onboarding@resend.dev`, los correos solo llegan al dueño de la cuenta de Resend. Hace falta un dominio verificado.

## 19.6 Reversión

Tabla: Procedimientos de reversión

| Situación | Acción |
|---|---|
| Despliegue defectuoso | En Railway → Deployments, volver a desplegar la versión anterior |
| Configuración incorrecta | El servidor no arranca y Railway conserva la versión anterior; corregir las variables y redesplegar |
| Migración interrumpida | Las migraciones se pueden repetir: corregir la causa y volver a ejecutar `db:migrate:remote` |
| Traslado incorrecto de la Administradora (antes del primer acceso) | `admin-transfer.js rollback --file <paquete>` con confirmación |
| Datos dañados | Detener el servicio, restaurar el último respaldo verificado y ejecutar `db:verificar` |

La guía completa, con los comandos de cada paso, está en `docs/DESPLIEGUE_RAILWAY.md` y `docs/GUIA_MYSQL_MIGRACIONES.md`.
