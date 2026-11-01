# Documentación — Mermelada ERP

| Documento | Audiencia | Contenido |
|---|---|---|
| [Manual de usuario](./MANUAL-USUARIO.md) | Personal administrativo, supervisores, operadores, almacén y costos | Acceso, roles, módulos, flujos diarios, reglas de auditoría, estado fiscal y solución de problemas. |
| [Manual de administración](./MANUAL-ADMINISTRADOR.md) | Responsable técnico | Arquitectura, PM2, variables de entorno, usuarios, backups y restauración, túnel, correo, endurecimiento de seguridad y checklist de puesta en marcha. |
| [Plan issue #11](./PLAN-ISSUE11.md) | Dirección, contabilidad y desarrollo | Requisitos SENIAT, libros, brechas, fases, módulos ocultables y criterios de aceptación. |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | DevOps | Docker, systemd, PM2, túnel y backups en producción. |
| [README.md](../README.md) | Desarrollo | Arquitectura, API, agentes, variables y pruebas. |

## Estado fiscal

El ERP incluye emisión de facturas, notas de crédito/débito, libros mensuales de
Ventas/Compras, exportación CSV auditada y cierre de período. La implementación
requiere validación de un contador público y no implica autorización del SENIAT.
Los cambios de configuración fiscal también quedan registrados en auditoría.
Retenciones, contabilidad formal, régimen SPE, IGTF y facturación digital se
definirán con el contador en el issue [#13](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13);
su implementación, si aplica, se planificará en issues separados vinculados al
issue [#11](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/11).
