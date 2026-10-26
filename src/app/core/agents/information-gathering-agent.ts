/**
 * InformationGatheringAgent - Agent responsible for collecting data from
 * multiple sources (internal database, external APIs, static files) and
 * synthesizing it into concise, human‑readable summaries for the UI or other agents.
 *
 * Features
 * --------
 * - Cacheo en memoria (MemoryAgent) para evitar llamadas repetidas a la BD o a APIs externas dentro de una sesión.
 * - Intento de API externa (ej. exchangerate.host) con fallback a la base de datos.
 * - Reportes listos para mostrar en dashboards: low‑stock, tasas de cambio, estado de producción.
 * - Todas las métodos son async y retornan tipos tipados.
 */
import { inject, Injectable } from '@angular/core';
import { DatabaseExpertAgent } from './database-expert-agent';
import { MemoryAgent } from './memory-agent';

/** Reporte de materiales con stock por debajo del mínimo. */
export interface LowStockReport {
  totalMaterials: number;
  lowStockCount: number;
  materials: {
    id: string;
    name: string;
    currentStock: number;
    minStock: number;
    unit: string;
  }[];
}

/** Resumen de tasas de cambio con origen y marca de tiempo. */
export interface ExchangeSummary {
  usd: number;
  usdt: number;
  source: 'database' | 'external API' | 'memory cache';
  fetchedAt: string;
}

/** Fragmento de información de producción. */
export interface ProductionSummary {
  total: number;
  completed: number;
  inProgress: number;
}

/** Resumen ejecutivo para el dashboard principal. */
export interface DashboardSummary {
  lowStock: string;
  exchangeRates: string;
  production: string;
}

/**
 * Agente que obtiene datos del ERP y los sintetiza.
 * Se inyecta típicamente a través de AgentsService o directamente en componentes.
 */
@Injectable({ providedIn: 'root' })
export class InformationGatheringAgent {
  private readonly memory = inject(MemoryAgent);
  private readonly db = inject(DatabaseExpertAgent);

  /**
   * Obtiene un reporte de materiales con stock bajo, usando cacheo en memoria.
   * Si ya fue calculado en esta sesión, se devuelve el valor guardado.
   */
  async getLowStockReport(): Promise<LowStockReport> {
    const cached = this.memory.get<LowStockReport>('lowStockReport');
    if (cached) return cached;

    const all = this.db.getRawMaterials();
    const low = all.filter((m: any) => m.currentStock < m.minStock);
    const report: LowStockReport = {
      totalMaterials: all.length,
      lowStockCount: low.length,
      materials: low.map((m: any) => ({
        id: m.id,
        name: m.name,
        currentStock: m.currentStock,
        minStock: m.minStock,
        unit: m.unit,
      })),
    };

    this.memory.set('lowStockReport', report);
    return report;
  }

  /**
   * Obtiene el resumen de tasas de cambio.
   * - Primero revisa la memoria caché (válida 5 minutos).
   * - Si no hay caché reciente, intenta consultar una API externa (exchangerate.host).
   * - Finalmente cae de nuevo a la base de datos local.
   * Devuelve el origen ('database', 'external API', 'memory cache') y la marca de tiempo.
   */
  async getExchangeSummary(): Promise<ExchangeSummary> {
    // 1. Memoria caché reciente (5 min)
    const memo = this.memory.get<{ usd: number; usdt: number; ts: number }>('exchangeRates');
    const now = Date.now();
    const fresh = memo && now - memo.ts < 5 * 60 * 1000;

    if (fresh && memo?.usd !== undefined && memo?.usdt !== undefined) {
      return {
        usd: memo.usd,
        usdt: memo.usdt,
        source: 'memory cache',
        fetchedAt: new Date(memo.ts).toISOString(),
      };
    }

    // 2. Base de datos local
    const dbRates = this.db.getExchangeRates();
    let usd = dbRates.currentUsd;
    let usdt = dbRates.currentUsdt;
    let source: 'database' | 'external API' = 'database';

    // 3. Intento de API externa (exchangerate.host). Funciona en navegador y en Node SSR con fetch.
    try {
      const resp = await fetch('https://api.exchangerate.host/latest?usd,usdt');
      if (resp.ok) {
        const data = await resp.json();
        usd = data.rates?.usd ?? usd;
        usdt = data.rates?.usdt ?? usdt;
        source = 'external API';
      }
    } catch (e) {
      // Silencioso: si falla la red usamos la BD
      console.warn('No se pudo obtener la tasa de cambio externa', e);
    }

    // 4. Guardar en memoria para próximas llamadas
    this.memory.set('exchangeRates', { usd, usdt, ts: now });

    return {
      usd,
      usdt,
      source,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Obtiene un resumen del estado de las órdenes de producción. */
  getProductionSummary(): ProductionSummary {
    const all = this.db.getProductionOrders();
    const completed = all.filter((po: any) => po.status === 'completada').length;
    const inProgress = all.filter(
      (po: any) => po.status === 'en_proceso' || po.status === 'en_produccion'
    ).length;
    return { total: all.length, completed, inProgress };
  }

  /** Sintetiza un resumen ejecutivo para el dashboard principal. */
  async getDashboardSummary(): Promise<DashboardSummary> {
    const [lowStock, exchange, prodSum] = await Promise.all([
      this.getLowStockReport(),
      this.getExchangeSummary(),
      // Production summary is synchronous, but wrap in Promise for consistency
      Promise.resolve(this.getProductionSummary()),
    ]);

    return {
      lowStock: `${lowStock.lowStockCount} of ${lowStock.totalMaterials} materials below minimum stock`,
      exchangeRates: `1 USD = ${exchange.usd} Bs, 1 USDT = ${exchange.usdt} Bs (${exchange.source}, ${exchange.fetchedAt})`,
      production: `Orders: ${prodSum.completed} completed, ${prodSum.inProgress} in progress out of ${prodSum.total} total`,
    };
  }
}