# 3. Justificación

<!-- sub: Por qué era necesario construir este software -->

## 3.1 Importancia del proyecto

El PIAR es una obligación legal y, sobre todo, una herramienta pedagógica. Si el plan está incompleto, desactualizado o disperso, los ajustes razonables no llegan al aula. Un sistema que centralice el plan, controle quién lo modifica y muestre su avance ayuda a que el derecho a la educación inclusiva se cumpla en la práctica.

## 3.2 Beneficios esperados

Tabla: Beneficios y mecanismo que los produce

| Beneficio | Cómo lo consigue el sistema | Estado |
|---|---|---|
| Información centralizada | Un registro por estudiante con todos sus PIAR, barreras, ajustes y seguimientos en MySQL | [IMPLEMENTADO] |
| Trazabilidad completa | Cada edición del PIAR exige justificación y genera una versión en `historial` e `historial_detalle`; observaciones y seguimientos no se editan | [IMPLEMENTADO] [PROBADO LOCAL] |
| Ajustes con sentido pedagógico | Cada ajuste se vincula a una barrera del mismo PIAR (clave foránea compuesta) y admite evidencias y avance de 0 a 100 | [IMPLEMENTADO] [PROBADO LOCAL] |
| Protección de datos de menores | Permisos por rol aplicados en el servidor, proyección reducida para el Estudiante, auditoría sin contenido | [IMPLEMENTADO] [PROBADO LOCAL] |
| Seguimiento institucional | Tablero con totales, avance promedio, distribución por necesidad y alertas | [IMPLEMENTADO] |
| Continuidad entre años | Informes persistentes con una instantánea del plan construida por el servidor | [IMPLEMENTADO] [PROBADO LOCAL] |

## 3.3 Justificación técnica

- **Sin frameworks pesados:** el servidor usa el módulo `http` nativo de Node.js y el cliente usa JavaScript sin frameworks. Hay solo cuatro dependencias de producción (`bcryptjs`, `mysql2`, `nodemailer`, `openid-client`), lo que reduce la superficie de ataque y el mantenimiento. La auditoría de dependencias (`npm audit --omit=dev`) reportó 0 vulnerabilidades.
- **Base de datos relacional:** MySQL garantiza integridad con 47 claves foráneas y transacciones en las operaciones críticas, como crear una cuenta Estudiante vinculada.
- **Despliegue reproducible:** una imagen Docker y migraciones versionadas con checksum permiten recrear el esquema de producción desde cero.

## 3.4 Marco normativo

- **Decreto 1421 de 2017** (compilado en el Decreto 1075 de 2015): define el PIAR y sus componentes.
- **Ley 1581 de 2012** y **Decreto 1377 de 2013:** protección de datos personales. Los datos de niñas, niños y adolescentes tienen protección reforzada.
- **Ley 1618 de 2013:** garantiza los derechos de las personas con discapacidad.

> **Nota:** los controles técnicos del sistema apoyan el cumplimiento normativo, pero no sustituyen la política institucional de tratamiento de datos ni la autorización de los titulares y acudientes.
