# Plan de limpieza del historial público

Estado: **preparado, no ejecutado.** Requiere aprobación explícita, porque reescribe el historial y exige `push --force` sobre `main`.

## 0. Verificación del 2026-11-22

- **Análisis del historial:** se aplicaron las reglas de `npm run check:secrets` a los 16 commits de todas las referencias. Los resultados están en `docs/PROCEDIMIENTOS_PENDIENTES.md` §B.
  - Se confirman `data/db.json`, `docs/PIAR-DOC-05-MODULOS.md`, `public/js/data.js` y `backend/server.js`.
  - El aviso sobre `docs/RAILWAY_DATABASE_SETUP.md` era un falso positivo (una referencia de Railway `${{…}}`).
- **Credencial expuesta:** se comparó en solo lectura con las cuentas de `piar_test` y **no coincide** con ninguna (tampoco con la Administradora 178).
- **Rotación:** solo afecta a la cuenta de Gmail del historial y a cualquier servicio donde se haya reutilizado la contraseña.
- **Herramientas:** `git-filter-repo` y `gh` no están instalados en este equipo.
- **Visibilidad del repositorio:** no se pudo confirmar desde aquí; hay que verla en GitHub → Settings → General.

## 1. Qué está expuesto

El repositorio `github.com/guido4574-jpg/PIAR-SISTEMA` es público. Solo la rama `main` está publicada (`git ls-remote`); no hay etiquetas. Los valores no se reproducen aquí.

| Commit | Fecha | Archivos con datos sensibles en ese commit |
|---|---|---|
| `fcd8c85` | 2026-06-21 | `data/db.json` |
| `f79315b` | 2026-07-07 | `data/db.json`, `docs/PIAR-DOC-05-MODULOS.md`, `backend/server.js` |
| `2ae1f9c` | 2026-08-16 | `data/db.json`, `docs/PIAR-DOC-05-MODULOS.md`, `public/js/data.js`, `backend/server.js` |
| `8272c9e` | 2026-09-13 | `data/db.json`, `docs/PIAR-DOC-05-MODULOS.md`, `public/js/data.js` |
| `HEAD` de `main` (27a87f8) | — | `data/db.json`, `docs/PIAR-DOC-05-MODULOS.md`, `public/js/data.js` |

Contenido afectado:

- **Una credencial de acceso de demostración:** correo con dominio `gmail.com` y contraseña de 8 caracteres.
- **Datos personales:**
  - Documentos de identidad de 3 estudiantes, con diagnósticos y discapacidades (datos de menores, sensibles según la Ley 1581).
  - Documentos y teléfonos de 2 docentes.

Además existen referencias **locales** de herramientas (`refs/agents/…`, `refs/codex/…`) con esos mismos datos. No están publicadas.

## 2. Estado local ya corregido (sin commit)

- `data/db.json` está fuera del índice (`git rm --cached`). La copia está en `Desktop/PIAR-SISTEMA-respaldos/datos-sensibles/db.json`, fuera del proyecto.
- `public/js/data.js` y `docs/PIAR-DOC-05-MODULOS.md` ya no contienen la credencial ni los datos.
- `.gitignore` excluye `/data/`, los archivos `.env*` (salvo las plantillas), las cookies, las claves y los volcados.
- `npm run check:secrets` (también en la CI) falla si se versionan rutas o patrones sensibles.

## 3. Acciones que no dependen de reescribir el historial (hacer primero)

1. **Rotar la credencial.** Si la contraseña de demostración se usó en alguna cuenta real (en particular la cuenta de correo de ese dominio), cámbiala ya. Lo publicado debe considerarse comprometido aunque se limpie el historial, porque pudo haber sido clonado.
2. **Valorar la obligación legal.** Determinar con la institución si los datos de estudiantes y docentes eran reales. Si lo eran, evaluar la notificación a los titulares y a la SIC según la Ley 1581 de 2012 y su reglamentación.
3. Activar en GitHub *Secret scanning* y *Push protection* (Settings → Code security).
4. Opcional: dejar el repositorio en privado mientras se limpia.

## 4. Procedimiento de reescritura (requiere aprobación)

Requisitos: `git-filter-repo` instalado (`pip install git-filter-repo`) y ningún colaborador con trabajo sin publicar sobre `main`.

1. **Commitear primero el trabajo local** de la rama `security/fase-1-hardening`, para que la reescritura no pierda nada.
2. **Respaldo completo:** `git clone --mirror https://github.com/guido4574-jpg/PIAR-SISTEMA.git PIAR-SISTEMA-mirror-respaldo.git`. Guárdalo fuera del proyecto y sin publicarlo.
3. **Clon espejo de trabajo:** `git clone --mirror <url> PIAR-limpieza.git` y `cd PIAR-limpieza.git`.
4. **Archivo de reemplazos fuera del repositorio** (por ejemplo `..\reemplazos.txt`), escrito a mano por quien ejecute el proceso, con una línea `VALOR==>[retirado]` por cada valor sensible (el correo, la contraseña, cada documento y cada teléfono). No se versiona.
5. **Reescribir:**
   ```
   git filter-repo --invert-paths --path data/db.json --replace-text ..\reemplazos.txt
   ```
   Esto elimina `data/db.json` de todos los commits y reemplaza los valores en `public/js/data.js`, `docs/PIAR-DOC-05-MODULOS.md` y `backend/server.js` históricos.
6. **Verificar** que no quede ningún valor: `git log --all -S "<valor>"` debe devolver vacío para cada valor. Ejecuta también `npm run check:secrets` en un checkout del resultado.
7. **Publicar** (paso irreversible para los demás clones): `git push --force --mirror origin`, o `git push --force origin main` si solo se reescribe `main`.
8. **Repositorio local:** como los hashes cambian, vuelve a clonar o haz rebase de `security/fase-1-hardening` sobre la nueva `main`. Borra las referencias locales de herramientas (`git for-each-ref refs/agents refs/codex`) con `git update-ref -d`, después de confirmar que no se necesitan.
9. **GitHub:** pide a GitHub Support que purgue las vistas en caché y las referencias de pull requests que apunten a los commits antiguos (formulario "Remove sensitive data"). Revisa también si existen forks.
10. **Colaboradores:** deben volver a clonar. Un `pull` sobre un clon antiguo reintroduciría los datos.

## 5. Riesgo residual

La reescritura no borra copias ya clonadas, forks ni cachés externas. Por eso la rotación de la credencial (paso 3.1) y la valoración legal (paso 3.2) son obligatorias aunque se ejecute el paso 4.
