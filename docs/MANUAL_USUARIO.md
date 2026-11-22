# Manual de usuario de PIAR

Actualizado: 2026-11-22. La versión anterior está en `docs/historico/MANUAL_USUARIO_hasta_2026-11-22.md`.

**Antes de empezar:**
- **Correo:** mientras la institución no configure el correo (Gmail SMTP), los enlaces de verificación, recuperación, cambio de correo y avisos de decisión no llegan.
- **Acceso:** se hace solo con correo y contraseña. Los botones de Google, Microsoft y Apple están ocultos en esta versión.

## 1. Acceso

- Escribe tu correo y tu contraseña. Solo entra una cuenta activa. Una cuenta pendiente, rechazada o desactivada recibe el mismo mensaje que una contraseña incorrecta.
- Tras varios intentos fallidos, el acceso se bloquea temporalmente.
- La sesión dura 8 horas. **Cerrar sesión** la termina en el servidor.
- **¿Olvidaste tu contraseña?** envía un enlace de un solo uso que vence en 30 minutos. La respuesta no revela si el correo existe.
- Si tu cuenta tiene una contraseña temporal, el sistema te pide cambiarla antes de continuar (mínimo 14 caracteres).

## 2. Solicitar una cuenta (Docente, Psicólogo(a), Coordinador o Rector)

1. Pulsa **Registrarse**.
2. Completa nombre, apellidos, documento, correo, el perfil que solicitas y la contraseña. Elegir un perfil no concede permisos.
3. Abre el enlace de verificación que llega a tu correo. Vence en 24 horas; si no llegó, usa **Reenviar verificación de correo**.
4. Un Administrador revisa la solicitud. Recibirás un correo con la decisión: aprobada (ya puedes ingresar) o no aprobada.

## 3. Administración de cuentas (Administrador)

- **Solicitudes:**
  - Muestra las solicitudes con el correo verificado. Puedes **Aprobar** o **Rechazar**; rechazar exige un motivo.
  - El motivo queda registrado internamente y **no** se incluye en el correo a la persona.
  - Si el aviso no se pudo enviar, el sistema lo indica para que lo comuniques por otro medio.
- **Usuarios → Nueva cuenta (personal):** nombre, apellidos, documento, correo, perfil y una contraseña temporal. La persona verifica su correo y después la apruebas en Solicitudes.
- **Usuarios → Nueva cuenta → Perfil «Estudiante»:**
  1. Elige el estudiante en la lista. Solo aparecen estudiantes activos sin cuenta; al elegirlo se rellenan nombre, apellidos y documento.
  2. Marca la casilla que confirma que la institución tiene la **autorización del acudiente**.
  3. Indica el correo y una contraseña temporal.
  4. Al verificar el correo, el estudiante puede ingresar y debe cambiar la contraseña. Cada estudiante tiene una sola cuenta.
- **Editar:** nombre y correo. Si cambias el correo, el actual sigue funcionando hasta que se confirme el enlace enviado al nuevo; al confirmarlo se cierran las sesiones de esa cuenta.
- **Desactivar y reactivar:** al desactivar se cierran las sesiones. No puedes desactivarte a ti mismo ni dejar la institución sin Administrador. El rol de una cuenta no se cambia desde la interfaz.

## 4. Qué puede hacer cada rol

| Rol | Puede |
|---|---|
| Administrador | Solicitudes y Usuarios. Gestiona estudiantes, docentes y PIAR (crear, editar, cerrar y asignar docentes). Edita y elimina diagnósticos. Consulta observaciones y seguimientos, pero no los registra |
| Rector | Gestiona estudiantes y docentes. Crea, edita y cierra PIAR. Edita y elimina diagnósticos. Consulta reportes |
| Coordinador | Lo mismo que Rector, y además: reabre PIAR cerrados, crea diagnósticos y registra observaciones y seguimientos |
| Psicólogo(a) | Consulta la información institucional. Crea y edita diagnósticos y registra observaciones. No edita PIAR, ajustes, DUA ni seguimientos |
| Docente | Solo los estudiantes y PIAR asignados. Edita sus PIAR y registra barreras, ajustes razonables, evidencias, DUA, observaciones y seguimientos |
| Estudiante | Consulta solo su propio PIAR, sin diagnósticos, observaciones, seguimientos ni informes de salud, y sin opciones de edición. Puede imprimirlo |

El sistema aplica estas reglas aunque se intente acceder directamente. Un PIAR cerrado es de solo lectura.

## 5. Módulos

| Módulo | Uso |
|---|---|
| Dashboard | Totales, seguimientos recientes, avance promedio, distribución por necesidad y alertas. **Nueva observación** solo aparece para quien puede registrarla |
| Solicitudes | (Administrador) Aprobar o rechazar solicitudes verificadas |
| Usuarios | (Administrador) Crear, buscar, filtrar, editar, desactivar y reactivar cuentas |
| Estudiantes | Búsqueda y perfil. **Nuevo estudiante** y **Editar** para Administrador, Rector y Coordinador |
| Docentes | Consulta. **Nuevo docente** y **Editar** para Administrador, Rector y Coordinador |
| PIAR / PR | Crear y consultar planes. En el detalle, según el rol: barreras, ajustes razonables con evidencias, DUA, diagnósticos, observaciones, seguimientos, docentes asignados, historial de versiones, cierre, reapertura e impresión |
| Reportes | Genera el informe de un PIAR. El servidor guarda una instantánea en **Informes guardados** |
| Configuración | Datos de presentación en el navegador. El nombre de la institución lo fija el servidor |

**Editar un PIAR:**
- Escribe una justificación; cada cambio queda como versión.
- Puedes vaciar un campo opcional (metas, estrategias, fecha de revisión…) y el sistema lo guarda vacío.
- El título, el periodo y el año son obligatorios.

## 6. Recomendaciones

- No compartas tu contraseña ni los enlaces que recibes por correo: sirven una sola vez.
- No registres datos personales innecesarios en campos de texto libre.
- Cierra sesión al terminar, sobre todo en equipos compartidos.
