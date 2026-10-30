# Documentación — Mermelada ERP

| Documento | Audiencia | Contenido |
|---|---|---|
| [Manual de usuario](./MANUAL-USUARIO.md) | Personal administrativo, supervisores, operadores, almacén y costos | Acceso, roles, módulos, flujos diarios, reglas de auditoría, estado fiscal y solución de problemas. |
| [Manual de administración](./MANUAL-ADMINISTRADOR.md) | Responsable técnico | Arquitectura, PM2, variables de entorno, usuarios, backups y restauración, túnel, correo, endurecimiento de seguridad y checklist de puesta en marcha. |
| [Plan issue #11](./PLAN-ISSUE11.md) | Dirección, contabilidad y desarrollo | Requisitos SENIAT, libros, brechas, fases, módulos ocultables y criterios de aceptación. |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | DevOps | Docker, systemd, PM2, túnel y backups en producción. |
| [README.md](../README.md) | Desarrollo | Arquitectura, API, agentes, variables y pruebas. |

## Estado fiscal

El ERP no emite facturas fiscales todavía. La hoja de ruta (factura fiscal,
libros de ventas y compras, retenciones y facturación digital) se coordina en el
issue **#11** del repositorio y debe validarse con un contador público antes de
usarse en producción.
