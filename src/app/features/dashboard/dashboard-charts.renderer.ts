/**
 * Recharts integration helper for Angular Dashboard
 * Renders Recharts BarChart and LineChart for:
 * 1) Ventas Semanales (Weekly Sales)
 * 2) Inventory Turnover (Rotación de Inventario)
 */

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { WeeklySalesStat, InventoryTurnoverStat, InventoryTurnoverCategory } from '../../core/models/erp.models';
import { formatVeNumber } from '../../core/pipes/ve-currency.pipe';

export class DashboardRechartsManager {
  private salesBarRoot: Root | null = null;
  private salesLineRoot: Root | null = null;
  private turnoverLineRoot: Root | null = null;
  private turnoverBarRoot: Root | null = null;

  public renderWeeklySalesBar(
    container: HTMLElement,
    data: WeeklySalesStat[],
    currencyMode: 'USD' | 'Bs',
    exchangeRate: number
  ) {
    if (!container) return;
    if (!this.salesBarRoot) {
      this.salesBarRoot = createRoot(container);
    }

    const mult = currencyMode === 'Bs' ? exchangeRate : 1;
    const currSym = currencyMode === 'Bs' ? 'Bs. ' : '$';

    const formattedData = data.map(item => ({
      name: item.week,
      label: item.label,
      ingresos: Number((item.revenue * mult).toFixed(2)),
      costos: Number((item.cost * mult).toFixed(2)),
      margen: Number((item.margin * mult).toFixed(2)),
      margenPercent: item.marginPercent,
      status: item.status,
    }));

    const tooltipFormatter = (value: any, name: any) => {
      const num = typeof value === 'number' ? value : Number(value);
      return [`${currSym}${formatVeNumber(num, 2)}`, name === 'ingresos' ? 'Ingresos' : name === 'costos' ? 'Costos' : 'Margen'];
    };

    const element = React.createElement(
      ResponsiveContainer as any,
      { width: '100%', height: 280 },
      React.createElement(
        BarChart as any,
        { data: formattedData, margin: { top: 15, right: 20, left: 10, bottom: 5 } },
        React.createElement(CartesianGrid as any, { strokeDasharray: '3 3', stroke: '#e7e5e4', vertical: false }),
        React.createElement(XAxis as any, { dataKey: 'name', tick: { fill: '#78716c', fontSize: 12 }, stroke: '#d6d3d1' }),
        React.createElement(YAxis as any, {
          tick: { fill: '#78716c', fontSize: 11 },
          stroke: '#d6d3d1',
          tickFormatter: (val: any) => `${currSym}${val}`,
        }),
        React.createElement(Tooltip as any, {
          formatter: tooltipFormatter,
          contentStyle: {
            backgroundColor: '#1c1917',
            borderColor: '#292524',
            borderRadius: '8px',
            color: '#fafaf9',
            fontSize: '12px',
          },
        }),
        React.createElement(Legend as any, {
          wrapperStyle: { fontSize: '12px', paddingTop: '10px' },
          formatter: (value: string) =>
            value === 'ingresos' ? 'Facturación Neta' : value === 'costos' ? 'Costos Directos' : 'Margen Bruto',
        }),
        React.createElement(Bar as any, { dataKey: 'ingresos', fill: '#f59e0b', radius: [4, 4, 0, 0], name: 'ingresos' }),
        React.createElement(Bar as any, { dataKey: 'costos', fill: '#78716c', radius: [4, 4, 0, 0], name: 'costos' }),
        React.createElement(Bar as any, { dataKey: 'margen', fill: '#059669', radius: [4, 4, 0, 0], name: 'margen' })
      )
    );

    this.salesBarRoot.render(element);
  }

  public renderWeeklySalesLine(
    container: HTMLElement,
    data: WeeklySalesStat[]
  ) {
    if (!container) return;
    if (!this.salesLineRoot) {
      this.salesLineRoot = createRoot(container);
    }

    const formattedData = data.map(item => ({
      name: item.week,
      label: item.label,
      pequeno: item.smallUnitsSold,
      grande: item.largeUnitsSold,
      total: item.totalUnits,
      margenPct: item.marginPercent,
    }));

    const element = React.createElement(
      ResponsiveContainer as any,
      { width: '100%', height: 280 },
      React.createElement(
        LineChart as any,
        { data: formattedData, margin: { top: 15, right: 20, left: 10, bottom: 5 } },
        React.createElement(CartesianGrid as any, { strokeDasharray: '3 3', stroke: '#e7e5e4', vertical: false }),
        React.createElement(XAxis as any, { dataKey: 'name', tick: { fill: '#78716c', fontSize: 12 }, stroke: '#d6d3d1' }),
        React.createElement(YAxis as any, {
          yAxisId: 'units',
          tick: { fill: '#78716c', fontSize: 11 },
          stroke: '#d6d3d1',
          tickFormatter: (val: any) => `${val} uds`,
        }),
        React.createElement(YAxis as any, {
          yAxisId: 'pct',
          orientation: 'right',
          tick: { fill: '#059669', fontSize: 11 },
          stroke: '#059669',
          tickFormatter: (val: any) => `${val}%`,
        }),
        React.createElement(Tooltip as any, {
          contentStyle: {
            backgroundColor: '#1c1917',
            borderColor: '#292524',
            borderRadius: '8px',
            color: '#fafaf9',
            fontSize: '12px',
          },
          formatter: (value: any, name: any) => {
            if (name === 'margenPct') return [`${formatVeNumber(value, 1)}%`, 'Margen %'];
            if (name === 'pequeno') return [`${formatVeNumber(value, 0)} uds`, 'Frasco 250g'];
            if (name === 'grande') return [`${formatVeNumber(value, 0)} uds`, 'Frasco 1000g'];
            return [`${formatVeNumber(value, 0)} uds`, 'Total Unidades'];
          },
        }),
        React.createElement(Legend as any, {
          wrapperStyle: { fontSize: '12px', paddingTop: '10px' },
          formatter: (val: string) =>
            val === 'pequeno'
              ? 'Frasco Pequeño (250g)'
              : val === 'grande'
              ? 'Frasco Grande (1000g)'
              : 'Margen Bruto (%)',
        }),
        React.createElement(Line as any, {
          yAxisId: 'units',
          type: 'monotone',
          dataKey: 'pequeno',
          stroke: '#d97706',
          strokeWidth: 2,
          dot: { r: 4 },
          activeDot: { r: 6 },
          name: 'pequeno',
        }),
        React.createElement(Line as any, {
          yAxisId: 'units',
          type: 'monotone',
          dataKey: 'grande',
          stroke: '#0284c7',
          strokeWidth: 2,
          dot: { r: 4 },
          activeDot: { r: 6 },
          name: 'grande',
        }),
        React.createElement(Line as any, {
          yAxisId: 'pct',
          type: 'monotone',
          dataKey: 'margenPct',
          stroke: '#059669',
          strokeWidth: 3,
          strokeDasharray: '4 4',
          dot: { r: 5, fill: '#059669' },
          name: 'margenPct',
        })
      )
    );

    this.salesLineRoot.render(element);
  }

  public renderInventoryTurnoverLine(
    container: HTMLElement,
    data: InventoryTurnoverStat[]
  ) {
    if (!container) return;
    if (!this.turnoverLineRoot) {
      this.turnoverLineRoot = createRoot(container);
    }

    const formattedData = data.map(item => ({
      name: item.period,
      label: item.label,
      turnover: item.turnoverRatio,
      dias: item.daysOfSupply,
      materiaPrima: item.rawMaterialsTurnover,
      productoTerminado: item.finishedGoodsTurnover,
      empaques: item.packagingTurnover,
    }));

    const element = React.createElement(
      ResponsiveContainer as any,
      { width: '100%', height: 280 },
      React.createElement(
        LineChart as any,
        { data: formattedData, margin: { top: 15, right: 25, left: 10, bottom: 5 } },
        React.createElement(CartesianGrid as any, { strokeDasharray: '3 3', stroke: '#e7e5e4', vertical: false }),
        React.createElement(XAxis as any, { dataKey: 'name', tick: { fill: '#78716c', fontSize: 12 }, stroke: '#d6d3d1' }),
        React.createElement(YAxis as any, {
          yAxisId: 'turnover',
          tick: { fill: '#78716c', fontSize: 11 },
          stroke: '#d6d3d1',
          tickFormatter: (val: any) => `${val}x`,
        }),
        React.createElement(YAxis as any, {
          yAxisId: 'days',
          orientation: 'right',
          tick: { fill: '#e11d48', fontSize: 11 },
          stroke: '#e11d48',
          tickFormatter: (val: any) => `${val}d`,
        }),
        React.createElement(Tooltip as any, {
          contentStyle: {
            backgroundColor: '#1c1917',
            borderColor: '#292524',
            borderRadius: '8px',
            color: '#fafaf9',
            fontSize: '12px',
          },
          formatter: (value: any, name: any) => {
            if (name === 'turnover') return [`${formatVeNumber(value, 1)}x rotaciones/año`, 'Rotación Global'];
            if (name === 'dias') return [`${formatVeNumber(value, 1)} días de stock`, 'Días de Inventario'];
            if (name === 'materiaPrima') return [`${formatVeNumber(value, 1)}x`, 'Rotación Fruta/Pulpa'];
            if (name === 'productoTerminado') return [`${formatVeNumber(value, 1)}x`, 'Rotación MTO Terminado'];
            return [`${formatVeNumber(value, 1)}x`, 'Rotación Envases'];
          },
        }),
        React.createElement(Legend as any, {
          wrapperStyle: { fontSize: '12px', paddingTop: '10px' },
          formatter: (val: string) =>
            val === 'turnover'
              ? 'Rotación Global (veces)'
              : val === 'dias'
              ? 'Días de Inventario (días)'
              : val === 'materiaPrima'
              ? 'Pulpa/Fruta'
              : 'Producto MTO',
        }),
        React.createElement(Line as any, {
          yAxisId: 'turnover',
          type: 'monotone',
          dataKey: 'turnover',
          stroke: '#059669',
          strokeWidth: 3,
          dot: { r: 5, fill: '#059669' },
          activeDot: { r: 7 },
          name: 'turnover',
        }),
        React.createElement(Line as any, {
          yAxisId: 'turnover',
          type: 'monotone',
          dataKey: 'materiaPrima',
          stroke: '#f59e0b',
          strokeWidth: 2,
          strokeDasharray: '3 3',
          dot: { r: 3 },
          name: 'materiaPrima',
        }),
        React.createElement(Line as any, {
          yAxisId: 'turnover',
          type: 'monotone',
          dataKey: 'productoTerminado',
          stroke: '#2563eb',
          strokeWidth: 2,
          strokeDasharray: '3 3',
          dot: { r: 3 },
          name: 'productoTerminado',
        }),
        React.createElement(Line as any, {
          yAxisId: 'days',
          type: 'monotone',
          dataKey: 'dias',
          stroke: '#e11d48',
          strokeWidth: 2,
          dot: { r: 4, fill: '#e11d48' },
          name: 'dias',
        })
      )
    );

    this.turnoverLineRoot.render(element);
  }

  public renderInventoryTurnoverBar(
    container: HTMLElement,
    data: InventoryTurnoverCategory[]
  ) {
    if (!container) return;
    if (!this.turnoverBarRoot) {
      this.turnoverBarRoot = createRoot(container);
    }

    const formattedData = data.map(item => ({
      name: item.category.split(' ')[0], // short name
      fullName: item.category,
      rotacion: item.turnoverRatio,
      dias: item.averageDaysInWarehouse,
      valor: item.inventoryValueUsd,
      clasificacion: item.turnoverClassification,
    }));

    const element = React.createElement(
      ResponsiveContainer as any,
      { width: '100%', height: 280 },
      React.createElement(
        BarChart as any,
        { data: formattedData, margin: { top: 15, right: 20, left: 10, bottom: 5 } },
        React.createElement(CartesianGrid as any, { strokeDasharray: '3 3', stroke: '#e7e5e4', vertical: false }),
        React.createElement(XAxis as any, { dataKey: 'name', tick: { fill: '#78716c', fontSize: 11 }, stroke: '#d6d3d1' }),
        React.createElement(YAxis as any, {
          yAxisId: 'ratio',
          tick: { fill: '#78716c', fontSize: 11 },
          stroke: '#d6d3d1',
          tickFormatter: (val: any) => `${val}x`,
        }),
        React.createElement(YAxis as any, {
          yAxisId: 'days',
          orientation: 'right',
          tick: { fill: '#78716c', fontSize: 11 },
          stroke: '#d6d3d1',
          tickFormatter: (val: any) => `${val}d`,
        }),
        React.createElement(Tooltip as any, {
          contentStyle: {
            backgroundColor: '#1c1917',
            borderColor: '#292524',
            borderRadius: '8px',
            color: '#fafaf9',
            fontSize: '12px',
          },
          formatter: (value: any, name: any) => {
            if (name === 'rotacion') return [`${formatVeNumber(value, 1)}x / año`, 'Tasa de Rotación'];
            return [`${formatVeNumber(value, 0)} días`, 'Días Promedio en Bodega'];
          },
        }),
        React.createElement(Legend as any, {
          wrapperStyle: { fontSize: '12px', paddingTop: '10px' },
          formatter: (val: string) => (val === 'rotacion' ? 'Tasa Rotación (Ratio x)' : 'Días en Almacén (Días)'),
        }),
        React.createElement(Bar as any, {
          yAxisId: 'ratio',
          dataKey: 'rotacion',
          fill: '#0d9488',
          radius: [4, 4, 0, 0],
          name: 'rotacion',
        }),
        React.createElement(Bar as any, {
          yAxisId: 'days',
          dataKey: 'dias',
          fill: '#f97316',
          radius: [4, 4, 0, 0],
          name: 'dias',
        })
      )
    );

    this.turnoverBarRoot.render(element);
  }

  public destroy() {
    this.salesBarRoot?.unmount();
    this.salesLineRoot?.unmount();
    this.turnoverLineRoot?.unmount();
    this.turnoverBarRoot?.unmount();
    this.salesBarRoot = null;
    this.salesLineRoot = null;
    this.turnoverLineRoot = null;
    this.turnoverBarRoot = null;
  }
}
