import {ChangeDetectionStrategy, Component, computed, inject, input, signal} from '@angular/core';
import {CommonModule, DatePipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../../core/services/erp-api.service';
import {AuditLogEntry} from '../../../core/models/erp.models';
import {exportToCsv} from '../../../core/utils/export.utils';

@Component({
  selector: 'app-audit-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, DatePipe],
  templateUrl: './audit-log.html',
})
export class AuditLog {
  public api = inject(ErpApiService);

  // Inputs
  public moduleFilter = input<'all' | 'inventario' | 'produccion' | 'gastos' | 'costos' | 'ventas'>('all');
  public title = input<string>('Log de Auditoría & Trazabilidad');
  public subtitle = input<string>('Historial cronológico inmutable de movimientos de stock, cocción en marmitas y lotes');
  public compact = input<boolean>(false);
  public showModuleTabs = input<boolean>(true);
  public showFilters = input<boolean>(true);

  // Local state signals
  public activeModuleFilter = signal<'all' | 'inventario' | 'produccion' | 'gastos' | 'costos' | 'ventas'>('all');
  public searchQuery = signal<string>('');
  public selectedActionType = signal<string>('all');
  public selectedSeverity = signal<string>('all');
  public expandedLogId = signal<string | null>(null);

  constructor() {
    // Sync initial activeModuleFilter with input
    // If input is specified, it will be the default
  }

  public currentModuleFilter = computed(() => {
    const fromInput = this.moduleFilter();
    const local = this.activeModuleFilter();
    return fromInput !== 'all' ? fromInput : local;
  });

  // Action type filter options
  public actionTypes = [
    {id: 'all', label: 'Todas las Acciones'},
    {id: 'entrada_materia_prima', label: 'Entradas de Materia Prima'},
    {id: 'salida_produccion', label: 'Salidas a Pailas'},
    {id: 'orden_produccion_creada', label: 'Órdenes Creadas (OP)'},
    {id: 'orden_produccion_procesada', label: 'Cocción & Lotes Finalizados'},
    {id: 'ajuste_merma', label: 'Ajustes & Mermas'},
    {id: 'receta_bom_creada', label: 'Formulaciones BOM'},
    {id: 'gasto_registrado', label: 'Comprobantes de Egreso Registrados'},
    {id: 'gasto_eliminado', label: 'Comprobantes de Egreso Eliminados'},
  ];

  // Filtered logs computation
  public filteredLogs = computed<AuditLogEntry[]>(() => {
    const logs = this.api.auditLogs();
    const mod = this.currentModuleFilter();
    const search = this.searchQuery().toLowerCase().trim();
    const action = this.selectedActionType();
    const sev = this.selectedSeverity();

    return logs.filter(log => {
      // Module check
      if (mod !== 'all' && log.module !== mod) {
        return false;
      }
      // Action type check
      if (action !== 'all' && log.actionType !== action) {
        return false;
      }
      // Severity check
      if (sev !== 'all' && log.severity !== sev) {
        return false;
      }
      // Text search check
      if (search) {
        const titleMatch = log.title.toLowerCase().includes(search);
        const descMatch = log.description.toLowerCase().includes(search);
        const userMatch = log.userName.toLowerCase().includes(search) || log.userRole.toLowerCase().includes(search);
        const lotMatch = log.details?.lotNumber?.toLowerCase().includes(search);
        const itemMatch = log.details?.itemName?.toLowerCase().includes(search);
        const docMatch = log.details?.referenceDoc?.toLowerCase().includes(search);
        const codeMatch = log.details?.targetCode?.toLowerCase().includes(search);

        if (!titleMatch && !descMatch && !userMatch && !lotMatch && !itemMatch && !docMatch && !codeMatch) {
          return false;
        }
      }
      return true;
    });
  });

  // Counters
  public totalInventoryLogs = computed(() => {
    return this.api.auditLogs().filter(l => l.module === 'inventario').length;
  });

  public totalProductionLogs = computed(() => {
    return this.api.auditLogs().filter(l => l.module === 'produccion').length;
  });

  public setModuleFilter(mod: 'all' | 'inventario' | 'produccion') {
    this.activeModuleFilter.set(mod);
  }

  public onSearchInput(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);
  }

  public toggleExpand(id: string) {
    this.expandedLogId.update(current => (current === id ? null : id));
  }

  public exportAuditLogsCsv() {
    const list = this.filteredLogs();
    const headers = [
      'ID Evento',
      'Fecha / Hora',
      'Módulo',
      'Tipo de Acción',
      'Título',
      'Descripción',
      'Usuario',
      'Rol',
      'Severidad',
      'Lote',
      'Ítem / Insumo',
      'Cantidad',
      'Unidad',
      'Grados Brix',
      'Merma Kg',
      'Documento Soporte',
    ];

    const rows = list.map(l => [
      l.id,
      l.timestamp,
      l.module.toUpperCase(),
      l.actionType,
      `"${l.title.replace(/"/g, '""')}"`,
      `"${l.description.replace(/"/g, '""')}"`,
      `"${l.userName}"`,
      `"${l.userRole}"`,
      l.severity,
      l.details?.lotNumber || '',
      `"${l.details?.itemName || ''}"`,
      l.details?.quantity !== undefined ? l.details.quantity : '',
      l.details?.unit || '',
      l.details?.brix !== undefined ? l.details.brix : '',
      l.details?.wasteKg !== undefined ? l.details.wasteKg : '',
      l.details?.referenceDoc || '',
    ]);

    exportToCsv(`log_auditoria_pulpacraft_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    this.api.showToast(`Exportados ${list.length} registros de auditoría en formato CSV.`);
  }

  public getActionIcon(actionType: string): string {
    switch (actionType) {
      case 'entrada_materia_prima':
        return 'add_box';
      case 'salida_produccion':
        return 'outbox';
      case 'orden_produccion_creada':
        return 'playlist_add';
      case 'orden_produccion_procesada':
        return 'verified';
      case 'ajuste_merma':
        return 'tune';
      case 'receta_bom_creada':
        return 'menu_book';
      case 'alerta_stock_critico':
        return 'warning';
      default:
        return 'history';
    }
  }

  public getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
}
