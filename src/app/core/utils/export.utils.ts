/**
 * Utilities for exporting ERP/MRP operational and financial data
 * to Excel (.xls/.xlsx compatible), CSV (with UTF-8 BOM and Venezuelan separators),
 * and downloadable PDF files via jsPDF and jspdf-autotable.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DeliveryNote,
  CostStructureAnalysis,
  FiscalSettings,
  RawMaterialCostItem,
  PackagingCostItem,
  FixedExpenseItem,
  WorkerPayrollItem,
} from '../models/erp.models';
import { formatVeNumber } from '../pipes/ve-currency.pipe';

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export table data to CSV with UTF-8 BOM and ';' delimiter
 * (compatible with Venezuelan / European Excel regional settings with decimal commas)
 */
export function exportToCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  let csvContent = '\uFEFF';

  const escapeCell = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  csvContent += headers.map(escapeCell).join(';') + '\r\n';

  for (const row of rows) {
    csvContent += row.map(escapeCell).join(';') + '\r\n';
  }

  downloadFile(csvContent, filename.endsWith('.csv') ? filename : `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Export table data to an Excel-compliant XML/HTML Workbook (.xls)
 * Opens seamlessly in Microsoft Excel, Google Sheets, LibreOffice with formatting and styles.
 */
export function exportToExcel(
  filename: string,
  sheetTitle: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  metadata?: {
    empresa?: string;
    rif?: string;
    fecha?: string;
    tasaCambio?: string;
    moneda?: string;
  }
) {
  const metaHtml = metadata
    ? `
    <tr>
      <td colspan="${headers.length}" style="font-size: 16pt; font-weight: bold; color: #1c1917; background-color: #f5f5f4; text-align: left; padding: 10px;">
        ${metadata.empresa || 'PulpaCraft MRP - Sistema de Gestión de Mermeladas'}
      </td>
    </tr>
    <tr>
      <td colspan="${headers.length}" style="font-size: 10pt; color: #57534e; background-color: #f5f5f4; text-align: left; padding: 4px;">
        RIF: ${metadata.rif || 'J-40899231-0'} · Fecha de Emisión: ${metadata.fecha || new Date().toLocaleString('es-VE')}
        ${metadata.tasaCambio ? ` · Tasa de Referencia: ${metadata.tasaCambio}` : ''}
        ${metadata.moneda ? ` · Moneda del Reporte: ${metadata.moneda}` : ''}
      </td>
    </tr>
    <tr><td colspan="${headers.length}" style="height: 15px;"></td></tr>
    `
    : '';

  const headersHtml = `
    <tr style="background-color: #292524; color: #ffffff; font-weight: bold; font-size: 10pt; text-align: center;">
      ${headers
        .map(
          h => `<th style="padding: 8px 12px; border: 1px solid #44403c; text-align: left;">${h}</th>`
        )
        .join('')}
    </tr>
  `;

  const rowsHtml = rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#fafaf9';
      const cells = row
        .map(cell => {
          const val = cell ?? '';
          const isNumeric = typeof val === 'number' || (!isNaN(Number(val)) && typeof val === 'string' && val.trim() !== '');
          const align = isNumeric ? 'right' : 'left';
          return `<td style="padding: 6px 10px; border: 1px solid #e7e5e4; text-align: ${align};">${val}</td>`;
        })
        .join('');
      return `<tr style="background-color: ${bg}; font-size: 9.5pt;">${cells}</tr>`;
    })
    .join('');

  const tableHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>${sheetTitle.slice(0, 31)}</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: Calibri, Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; }
        </style>
      </head>
      <body>
        <table>
          ${metaHtml}
          ${headersHtml}
          ${rowsHtml}
        </table>
      </body>
    </html>
  `;

  const fullFilename = filename.endsWith('.xls') || filename.endsWith('.xlsx') ? filename : `${filename}.xls`;
  downloadFile(tableHtml, fullFilename, 'application/vnd.ms-excel;charset=utf-8;');
}

/**
 * Generates and downloads a standardized tabular PDF report using jsPDF & autoTable.
 */
export function exportToPdf(
  titleOrOptions:
    | string
    | {
        title: string;
        subtitle?: string;
        empresa?: string;
        rif?: string;
        exchangeRateUsed?: number;
        currencyLabel?: string;
        headers: string[];
        rows: (string | number | null | undefined)[][];
        totals?: { label: string; value: string }[];
        notes?: string;
      },
  subtitle?: string,
  headers?: string[],
  rows?: (string | number | null | undefined)[][],
  totals?: { label: string; value: string }[]
) {
  const options =
    typeof titleOrOptions === 'object'
      ? titleOrOptions
      : {
          title: titleOrOptions,
          subtitle: subtitle,
          headers: headers || [],
          rows: rows || [],
          totals: totals,
        };

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Top header banner
  doc.setFillColor(30, 27, 24);
  doc.rect(0, 0, pageWidth, 55, 'F');

  // Accent amber stripe
  doc.setFillColor(217, 119, 6);
  doc.rect(0, 55, pageWidth, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(options.empresa || 'PulpaCraft MRP · Mermeladas Artesanales del Valle C.A.', 24, 25);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(214, 211, 209);
  doc.text(
    `RIF: ${options.rif || 'J-40899231-0'} · Fecha de Emisión: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`,
    24,
    42
  );

  // Document title on the right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(254, 243, 199);
  doc.text(options.title, pageWidth - 24, 25, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(214, 211, 209);
  let metaRight = '';
  if (options.exchangeRateUsed) {
    metaRight += `Tasa BCV: Bs. ${formatVeNumber(options.exchangeRateUsed, 2)}  `;
  }
  if (options.currencyLabel) {
    metaRight += `| Moneda: ${options.currencyLabel}`;
  }
  if (metaRight) {
    doc.text(metaRight, pageWidth - 24, 42, { align: 'right' });
  }

  let startY = 75;

  if (options.subtitle) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(87, 83, 78);
    doc.text(options.subtitle, 24, startY);
    startY += 15;
  }

  // Render Table
  autoTable(doc, {
    startY: startY,
    head: [options.headers],
    body: options.rows.map(r => r.map(c => (c !== null && c !== undefined ? String(c) : '-'))),
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 4,
      textColor: [41, 37, 36],
      lineColor: [231, 229, 228],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [41, 37, 36],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    alternateRowStyles: {
      fillColor: [250, 250, 249],
    },
    margin: { left: 24, right: 24 },
  });

  // Totals block if specified
  const finalY = (doc as any).lastAutoTable?.finalY || startY + 50;
  let cursorY = finalY + 12;

  if (options.totals && options.totals.length > 0) {
    const boxWidth = 260;
    const boxX = pageWidth - 24 - boxWidth;
    let tY = cursorY;

    doc.setFillColor(245, 245, 244);
    doc.roundedRect(boxX, tY, boxWidth, options.totals.length * 16 + 8, 4, 4, 'F');
    doc.setDrawColor(214, 211, 209);
    doc.roundedRect(boxX, tY, boxWidth, options.totals.length * 16 + 8, 4, 4, 'S');

    tY += 14;
    for (const t of options.totals) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(68, 64, 60);
      doc.text(`${t.label}:`, boxX + 10, tY);

      doc.setFont('courier', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(28, 25, 23);
      doc.text(t.value, boxX + boxWidth - 10, tY, { align: 'right' });
      tY += 15;
    }
    cursorY = tY + 8;
  }

  if (options.notes) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(`* ${options.notes}`, 24, cursorY + 10);
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(231, 229, 228);
    doc.setLineWidth(0.5);
    doc.line(24, pageHeight - 20, pageWidth - 24, pageHeight - 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(168, 162, 158);
    doc.text('PulpaCraft MRP · Sistema Integrado de Fabricación e Inteligencia Cambiaria', 24, pageHeight - 10);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - 24, pageHeight - 10, { align: 'right' });
  }

  const safeFilename = options.title.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`${safeFilename}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Generates and immediately downloads a formal Delivery Note (Nota de Entrega)
 * in official PDF format with company logo/banner, fiscal registration,
 * detailed items list, batch numbers, dual currency calculations (USD/Bs.),
 * and legal signature/acceptance blocks.
 */
export function downloadDeliveryNotePdf(
  note: DeliveryNote,
  fiscal?: FiscalSettings | null,
  currentExchangeRate?: number,
  currencyMode: 'USD' | 'Bs' = 'USD'
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;

  const rate = note.exchangeRateUsed || currentExchangeRate || 48.35;
  const companyName = fiscal?.companyName || 'Mermeladas Artesanales del Valle C.A.';
  const companyTaxId = fiscal?.companyTaxId || 'J-40899231-0';
  const fiscalAddress = fiscal?.fiscalAddress || 'Zona Industrial El Valle, Galpón PulpaCraft 4, Edo. Miranda';

  // 1. Header Banner
  doc.setFillColor(30, 27, 24); // #1e1b18
  doc.rect(0, 0, pageWidth, 75, 'F');

  // Accent stripe
  doc.setFillColor(217, 119, 6); // Amber 600
  doc.rect(0, 75, pageWidth, 5, 'F');

  // Header Title & Subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(companyName.toUpperCase(), margin, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(214, 211, 209);
  doc.text(`RIF: ${companyTaxId}  |  Registro Sanitario MPPS #DR-2026-9921`, margin, 48);
  doc.text(fiscalAddress, margin, 60);

  // Document Badge on top right
  doc.setFillColor(217, 119, 6);
  doc.roundedRect(pageWidth - margin - 150, 14, 150, 52, 4, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('NOTA DE ENTREGA', pageWidth - margin - 75, 28, { align: 'center' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(12.5);
  doc.text(note.noteNumber, pageWidth - margin - 75, 43, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`FECHA: ${note.dispatchDate} | ${currencyMode}`, pageWidth - margin - 75, 56, { align: 'center' });

  // 2. Info Cards (Client Info & Dispatch Info)
  let y = 100;

  // Box 1: Client Info
  const colWidth = (contentWidth - 14) / 2;
  doc.setFillColor(245, 245, 244);
  doc.setDrawColor(231, 229, 228);
  doc.roundedRect(margin, y, colWidth, 90, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 113, 108);
  doc.text('DATOS DEL CLIENTE / RECEPTOR', margin + 10, y + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(note.customerName, margin + 10, y + 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(68, 64, 60);
  doc.text(`RIF / Doc: ${note.customerTaxId}`, margin + 10, y + 46);
  doc.text(`Dirección: ${note.customerAddress || 'No especificada'}`, margin + 10, y + 59, {
    maxWidth: colWidth - 20,
  });
  doc.text(`Teléfono: ${note.customerPhone || 'N/A'}`, margin + 10, y + 80);

  // Box 2: Dispatch & Operation Info
  const box2X = margin + colWidth + 14;
  doc.setFillColor(245, 245, 244);
  doc.roundedRect(box2X, y, colWidth, 90, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 113, 108);
  doc.text('DATOS DEL DESPACHO & TASA', box2X + 10, y + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(68, 64, 60);
  doc.text(`Pedido de Origen:`, box2X + 10, y + 32);
  doc.setFont('helvetica', 'bold');
  doc.text(note.salesOrderNumber, box2X + 90, y + 32);

  doc.setFont('helvetica', 'normal');
  doc.text(`Transportista:`, box2X + 10, y + 46);
  doc.setFont('helvetica', 'bold');
  doc.text(note.transporter || 'Transporte Propio de Planta', box2X + 90, y + 46);

  doc.setFont('helvetica', 'normal');
  doc.text(`Estado Documento:`, box2X + 10, y + 60);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 83, 9);
  doc.text(note.status.toUpperCase(), box2X + 90, y + 60);

  // Daily exchange rate badge
  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(251, 191, 36);
  doc.roundedRect(box2X + 10, y + 68, colWidth - 20, 16, 3, 3, 'FD');
  doc.setTextColor(146, 64, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`TASA CAMBIARIA OFICIAL (BCV): Bs. ${formatVeNumber(rate, 2)} / USD`, box2X + (colWidth / 2), y + 79, {
    align: 'center',
  });

  y += 105;

  // 3. Items Dispatched Table
  const tableHeaders = [
    'Item',
    'Descripción del Producto',
    'Presentación',
    'Lote',
    'Cant.',
    'P. Unit (USD)',
    'Subtotal (USD)',
    'Subtotal (Bs.)',
  ];

  const tableBody = (note.items || []).map((item, idx) => {
    const subtotalUsd = item.subtotal;
    const subtotalBs = item.subtotalBs || subtotalUsd * rate;
    return [
      String(idx + 1),
      item.description,
      item.presentationLabel || '-',
      item.lotNumber || 'LT-2026-OK',
      formatVeNumber(item.quantity, 0),
      `$ ${formatVeNumber(item.unitPrice, 2)}`,
      `$ ${formatVeNumber(subtotalUsd, 2)}`,
      `Bs. ${formatVeNumber(subtotalBs, 2)}`,
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [tableHeaders],
    body: tableBody,
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 4.5,
      textColor: [41, 37, 36],
      lineColor: [214, 211, 209],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [41, 37, 36],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 26 },
      1: { cellWidth: 155 },
      2: { cellWidth: 90 },
      3: { halign: 'center', cellWidth: 65, font: 'courier' },
      4: { halign: 'right', cellWidth: 40, fontStyle: 'bold' },
      5: { halign: 'right', cellWidth: 55, font: 'courier' },
      6: { halign: 'right', cellWidth: 60, font: 'courier', fontStyle: 'bold' },
      7: { halign: 'right', cellWidth: 70, font: 'courier', fontStyle: 'bold' },
    },
    alternateRowStyles: {
      fillColor: [250, 250, 249],
    },
    margin: { left: margin, right: margin },
  });

  const finalTableY = (doc as any).lastAutoTable?.finalY || y + 100;
  y = finalTableY + 12;

  // 4. Observations & Totals Box
  const totalsBoxWidth = 230;
  const totalsBoxX = pageWidth - margin - totalsBoxWidth;

  // Observations box on the left
  const obsBoxWidth = contentWidth - totalsBoxWidth - 14;
  doc.setFillColor(250, 250, 249);
  doc.setDrawColor(231, 229, 228);
  doc.roundedRect(margin, y, obsBoxWidth, 105, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text('OBSERVACIONES Y CLÁUSULAS DE ENTREGA:', margin + 8, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(87, 83, 78);
  const obsLines = [
    '• Este documento ampara el traslado físico y entrega conforme de los productos terminados.',
    '• Lotes verificados con sellado al vacío, 65° Brix estándar y control sanitario.',
    '• Cualquier inconformidad debe ser notificada en un lapso no mayor a 24 horas continuas.',
    '• Las operaciones comerciales en moneda extranjera se cancelan al tipo de cambio oficial BCV.',
    note.observations ? `• Nota interna: ${note.observations}` : '',
  ].filter(Boolean);

  doc.text(obsLines, margin + 8, y + 28, { maxWidth: obsBoxWidth - 16, lineHeightFactor: 1.3 });

  // Totals box on the right
  doc.setFillColor(245, 245, 244);
  doc.roundedRect(totalsBoxX, y, totalsBoxWidth, 105, 4, 4, 'FD');

  const subtotalUsd = note.subtotal;
  const taxAmountUsd = note.taxAmount;
  const totalUsd = note.total;

  const subtotalBs = note.subtotalBs || subtotalUsd * rate;
  const taxAmountBs = note.taxAmountBs || taxAmountUsd * rate;
  const totalBs = note.totalBs || totalUsd * rate;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(68, 64, 60);
  doc.text('Base Imponible:', totalsBoxX + 10, y + 17);
  doc.setFont('courier', 'bold');
  doc.text(`$ ${formatVeNumber(subtotalUsd, 2)} (${formatVeNumber(subtotalBs, 2)} Bs.)`, totalsBoxX + totalsBoxWidth - 10, y + 17, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.text(`I.V.A. (16%):`, totalsBoxX + 10, y + 31);
  doc.setFont('courier', 'bold');
  doc.text(`$ ${formatVeNumber(taxAmountUsd, 2)} (${formatVeNumber(taxAmountBs, 2)} Bs.)`, totalsBoxX + totalsBoxWidth - 10, y + 31, { align: 'right' });

  // Highlighted Total USD
  doc.setFillColor(30, 27, 24);
  doc.roundedRect(totalsBoxX + 6, y + 40, totalsBoxWidth - 12, 26, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL A PAGAR (USD):', totalsBoxX + 12, y + 56);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(254, 243, 199);
  doc.text(`$ ${formatVeNumber(totalUsd, 2)}`, totalsBoxX + totalsBoxWidth - 12, y + 56, { align: 'right' });

  // Highlighted Total Bs.
  doc.setFillColor(254, 243, 199);
  doc.roundedRect(totalsBoxX + 6, y + 70, totalsBoxWidth - 12, 26, 3, 3, 'F');
  doc.setTextColor(146, 64, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('TOTAL BOLÍVARES (BCV):', totalsBoxX + 12, y + 86);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(`Bs. ${formatVeNumber(totalBs, 2)}`, totalsBoxX + totalsBoxWidth - 12, y + 86, { align: 'right' });

  y += 125;

  // 5. Signature and Acceptance Blocks
  const sigWidth = (contentWidth - 24) / 2;

  // Dispatcher Signature
  doc.setDrawColor(168, 162, 158);
  doc.setLineWidth(0.8);
  doc.line(margin, y + 45, margin + sigWidth, y + 45);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(41, 37, 36);
  doc.text('DESPACHADO POR PLANTA / ALMACÉN', margin + sigWidth / 2, y + 57, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text(`Firma y Sello: ${note.transporter || 'Control de Despachos PulpaCraft'}`, margin + sigWidth / 2, y + 68, { align: 'center' });

  // Customer Receiver Signature
  const sig2X = margin + sigWidth + 24;
  doc.line(sig2X, y + 45, sig2X + sigWidth, y + 45);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(41, 37, 36);
  doc.text('RECIBIDO CONFORME / CLIENTE', sig2X + sigWidth / 2, y + 57, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('Nombre, C.I., Firma y Sello del Receptor', sig2X + sigWidth / 2, y + 68, { align: 'center' });

  // 6. Footer
  doc.setDrawColor(231, 229, 228);
  doc.line(margin, pageHeight - 25, pageWidth - margin, pageHeight - 25);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(168, 162, 158);
  doc.text('PulpaCraft MRP · Mermeladas Artesanales del Valle C.A. · Documento de Control de Despachos', margin, pageHeight - 14);
  doc.text(`Impreso / Descargado el ${new Date().toLocaleString('es-VE')}`, pageWidth - margin, pageHeight - 14, { align: 'right' });

  // Save / Trigger Download
  const filename = `Nota_Entrega_${note.noteNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  doc.save(filename);
}

/**
 * Generates and downloads an Executive Cost Summary (Resumen de Costos)
 * in official PDF format. Includes unit costs, direct materials, packaging,
 * labor, CIF allocations, inactivity absorption, and suggested wholesale/retail prices.
 */
export function downloadCostingSummaryPdf(
  costData: CostStructureAnalysis,
  exchangeRate: number,
  simulationResult?: {
    totalUnitCost?: number;
    inactiveAbsorbedPerUnit?: number;
    suggestedWholesalePrice?: number;
    suggestedRetailPrice?: number;
    wholesaleGrossProfit?: number;
    retailGrossProfit?: number;
  } | null,
  currencyMode: 'USD' | 'Bs' = 'USD'
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;
  const isBs = currencyMode === 'Bs';
  const mult = isBs ? exchangeRate : 1;
  const currSymbol = isBs ? 'Bs.' : '$';

  // 1. Header Banner
  doc.setFillColor(30, 27, 24);
  doc.rect(0, 0, pageWidth, 75, 'F');

  // Accent stripe
  doc.setFillColor(217, 119, 6);
  doc.rect(0, 75, pageWidth, 5, 'F');

  // Header Title & Subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PULPACRAFT MRP · REPORTE FINANCIERO DE COSTOS', margin, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(214, 211, 209);
  doc.text('Mermeladas Artesanales del Valle C.A. · RIF: J-40899231-0', margin, 48);
  doc.text('Estructura de Costeo por Absorción Parcial Make-to-Order e Inteligencia de Precios', margin, 60);

  // Badge on the right
  doc.setFillColor(217, 119, 6);
  doc.roundedRect(pageWidth - margin - 160, 16, 160, 48, 4, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('RESUMEN DE COSTOS', pageWidth - margin - 80, 32, { align: 'center' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.text(`${new Date().toISOString().slice(0, 10)}`, pageWidth - margin - 80, 48, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`TASA: Bs. ${formatVeNumber(exchangeRate, 2)}`, pageWidth - margin - 80, 59, { align: 'center' });

  let y = 98;

  // 2. Executive Metric Cards
  const cardWidth = (contentWidth - 18) / 3;

  // Card 1: Direct Labor Weekly Average
  doc.setFillColor(245, 245, 244);
  doc.setDrawColor(231, 229, 228);
  doc.roundedRect(margin, y, cardWidth, 54, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('NÓMINA SEMANAL PROMEDIO', margin + 8, y + 14);

  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text(
    `${currSymbol} ${formatVeNumber(costData.directLaborWeeklyAverage * mult, 2)}`,
    margin + 8,
    y + 32
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `≈ ${isBs ? '$' : 'Bs.'} ${formatVeNumber(isBs ? costData.directLaborWeeklyAverage : costData.directLaborWeeklyAverage * exchangeRate, 2)}`,
    margin + 8,
    y + 46
  );

  // Card 2: Inactive Weeks & Fixed Absorption
  const card2X = margin + cardWidth + 9;
  doc.setFillColor(245, 245, 244);
  doc.roundedRect(card2X, y, cardWidth, 54, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('SEMANAS INACTIVAS Y ABSORCIÓN', card2X + 8, y + 14);

  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(180, 83, 9);
  doc.text(
    `${costData.inactiveWeeksCountYTD} Semanas`,
    card2X + 8,
    y + 32
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Costo no absorbido: ${currSymbol} ${formatVeNumber(costData.unabsorbedFixedCostYTD * mult, 2)}`,
    card2X + 8,
    y + 46
  );

  // Card 3: Indirect Costs (CIF) Weekly
  const card3X = card2X + cardWidth + 9;
  doc.setFillColor(245, 245, 244);
  doc.roundedRect(card3X, y, cardWidth, 54, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('COSTOS INDIRECTOS (CIF / SEMANA)', card3X + 8, y + 14);

  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text(
    `${currSymbol} ${formatVeNumber(costData.indirectManufacturingCostsWeekly * mult, 2)}`,
    card3X + 8,
    y + 32
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Gas, agua, electricidad y depreciación', card3X + 8, y + 46);

  y += 68;

  // 3. Main Cost Structure Table by Presentation
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(28, 25, 23);
  doc.text('1. DESGLOSE UNITARIO Y RENTABILIDAD POR PRESENTACIÓN', margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text(`Valores expresados en ${isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)'}`, pageWidth - margin, y, { align: 'right' });

  y += 8;

  const costHeaders = [
    'Presentación',
    'Mat. Prima',
    'Empaque',
    'Mano Obra',
    'CIF',
    'Costo Unit.',
    'PVP Mayor (Margen)',
    'PVP Detal (Margen)',
  ];

  const costRows = (costData.costBreakdownByPresentation || []).map(item => [
    item.label,
    `${currSymbol} ${formatVeNumber(item.directMaterial * mult, 2)}`,
    `${currSymbol} ${formatVeNumber(item.directPackaging * mult, 2)}`,
    `${currSymbol} ${formatVeNumber(item.directLabor * mult, 2)}`,
    `${currSymbol} ${formatVeNumber(item.cifAllocation * mult, 2)}`,
    `${currSymbol} ${formatVeNumber(item.totalUnitCost * mult, 2)}`,
    `${currSymbol} ${formatVeNumber(item.suggestedWholesalePrice * mult, 2)} (${formatVeNumber(item.marginWholesalePercent, 1)}%)`,
    `${currSymbol} ${formatVeNumber(item.suggestedRetailPrice * mult, 2)} (${formatVeNumber(item.marginRetailPercent, 1)}%)`,
  ]);

  autoTable(doc, {
    startY: y,
    head: [costHeaders],
    body: costRows,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 5,
      textColor: [41, 37, 36],
      lineColor: [214, 211, 209],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [41, 37, 36],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 100 },
      1: { halign: 'right', font: 'courier' },
      2: { halign: 'right', font: 'courier' },
      3: { halign: 'right', font: 'courier' },
      4: { halign: 'right', font: 'courier' },
      5: { halign: 'right', font: 'courier', fontStyle: 'bold', textColor: [180, 83, 9] },
      6: { halign: 'right', font: 'courier' },
      7: { halign: 'right', font: 'courier' },
    },
    alternateRowStyles: {
      fillColor: [250, 250, 249],
    },
    margin: { left: margin, right: margin },
  });

  const tableFinalY = (doc as any).lastAutoTable?.finalY || y + 100;
  y = tableFinalY + 16;

  // 4. Comparative Cost Breakdown Explanation Box
  doc.setFillColor(245, 245, 244);
  doc.setDrawColor(231, 229, 228);
  doc.roundedRect(margin, y, contentWidth, 75, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(28, 25, 23);
  doc.text('ANÁLISIS DE ABSORCIÓN Y POLÍTICA DE FIJACIÓN DE PRECIOS:', margin + 10, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(68, 64, 60);
  const explanatoryText = [
    '• Modelo Make-to-Order (MTO): La producción solo se activa bajo pedido en firme, reduciendo mermas y capital inmovilizado.',
    '• Absorción de Semanas Inactivas: Las semanas sin cocción (mantenimiento o estacionalidad de fruta) distribuyen la nómina básica fija',
    '  entre los lotes producidos, garantizando que el costo unitario real contemple la totalidad de las erogaciones laborales.',
    `• Tasa de Conversión Oficial: Todos los costos están indexados con la tasa BCV del día (Bs. ${formatVeNumber(exchangeRate, 2)}) para salvaguardar el margen ante variaciones cambiarias.`,
  ];
  doc.text(explanatoryText, margin + 10, y + 27, { lineHeightFactor: 1.35 });

  y += 88;

  // 5. Active Simulation Result Box (if available)
  if (simulationResult && simulationResult.totalUnitCost) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(28, 25, 23);
    doc.text('2. RESULTADOS DEL SIMULADOR DE COSTOS & ESCENARIOS ACTIVOS', margin, y);

    y += 8;

    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(251, 191, 36);
    doc.roundedRect(margin, y, contentWidth, 78, 4, 4, 'FD');

    const simUnitCost = simulationResult.totalUnitCost * mult;
    const simInact = (simulationResult.inactiveAbsorbedPerUnit || 0) * mult;
    const simWholesale = (simulationResult.suggestedWholesalePrice || 0) * mult;
    const simRetail = (simulationResult.suggestedRetailPrice || 0) * mult;
    const simWholesaleProfit = (simulationResult.wholesaleGrossProfit || 0) * mult;
    const simRetailProfit = (simulationResult.retailGrossProfit || 0) * mult;

    const simColWidth = contentWidth / 3;

    // Col 1
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text('COSTO SIMULADO:', margin + 10, y + 16);
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(28, 25, 23);
    doc.text(`${currSymbol} ${formatVeNumber(simUnitCost, 2)} / ud`, margin + 10, y + 32);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 113, 108);
    doc.text(`Incluye absorción de ${currSymbol} ${formatVeNumber(simInact, 2)} por unidad inactiva`, margin + 10, y + 46);

    // Col 2
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text('CANAL MAYORISTA (Panaderías):', margin + simColWidth, y + 16);
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(28, 25, 23);
    doc.text(`${currSymbol} ${formatVeNumber(simWholesale, 2)} / ud`, margin + simColWidth, y + 32);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(22, 101, 52);
    doc.text(`Ganancia Bruta: ${currSymbol} ${formatVeNumber(simWholesaleProfit, 2)} / ud`, margin + simColWidth, y + 46);

    // Col 3
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text('CANAL DETAL / CONSUMIDOR FINAL:', margin + simColWidth * 2, y + 16);
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(28, 25, 23);
    doc.text(`${currSymbol} ${formatVeNumber(simRetail, 2)} / ud`, margin + simColWidth * 2, y + 32);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(22, 101, 52);
    doc.text(`Ganancia Bruta: ${currSymbol} ${formatVeNumber(simRetailProfit, 2)} / ud`, margin + simColWidth * 2, y + 46);

    y += 92;
  }

  // 6. Sign-off / Certification
  const authBoxY = Math.max(y + 10, pageHeight - 95);
  doc.setDrawColor(214, 211, 209);
  doc.line(margin, authBoxY, pageWidth - margin, authBoxY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(68, 64, 60);
  doc.text('CERTIFICACIÓN Y CONTROL DE GESTIÓN FINANCIERA', margin, authBoxY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('Elaborado por: Gerencia de Costos y Producción · Aprobado por: Dirección de Operaciones PulpaCraft', margin, authBoxY + 26);
  doc.text(`Fecha y Hora de Emisión: ${new Date().toLocaleString('es-VE')}`, pageWidth - margin, authBoxY + 26, { align: 'right' });

  // Footer on bottom
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(168, 162, 158);
  doc.text('PulpaCraft MRP · Sistema Integrado de Fabricación e Inteligencia Cambiaria', margin, pageHeight - 12);
  doc.text('Documento Financiero Confidencial', pageWidth - margin, pageHeight - 12, { align: 'right' });

  // Save / Trigger Download
  const filename = `Resumen_Estructura_Costos_${currencyMode}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

export interface DetailedCostReportExportData {
  productionKilosBase: number;
  workDays: number;
  customMarginPercent: number;
  exchangeRate: number;
  currencyMode: 'USD' | 'Bs';
  rawMaterials: RawMaterialCostItem[];
  packaging20k: PackagingCostItem[];
  packagingCaja20k: PackagingCostItem[];
  packagingGalon: PackagingCostItem[];
  fixedExpenses: FixedExpenseItem[];
  workers: WorkerPayrollItem[];
  totalRawMaterialsCost: number;
  rawMaterialCostPerKg: number;
  rawMaterialCost20kg: number;
  rawMaterialCost5kg: number;
  totalPackaging20k: number;
  totalPackagingCaja20k: number;
  totalPackagingGalon: number;
  totalFixedMonthly: number;
  totalFixedDaily: number;
  totalFixedPerKg: number;
  fixedCost20kg: number;
  fixedCost5kg: number;
  costPer1kg: number;
  cost20kgWithoutPackaging: number;
  cuneteFinalCost: number;
  cajaFinalCost: number;
  galonFinalCost: number;
  cunetePrices: { margin30: number; margin25: number; margin20: number; custom: number };
  cajaPrices: { margin30: number; margin25: number; margin20: number; custom: number };
  galonPrices: { margin30: number; margin25: number; margin20: number; custom: number };
}

/**
 * Generates an executive, highly formatted Cost Estimation Report & Client Quotation PDF
 * based on the Excel calculation sheet (Image 2) and MTO production batches.
 */
export function downloadDetailedCostEstimationPdf(data: DetailedCostReportExportData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;
  const rate = data.exchangeRate || 48.35;
  const isBs = data.currencyMode === 'Bs';
  const mult = isBs ? rate : 1;
  const curr = isBs ? 'Bs.' : '$';

  // --- PAGE 1: HEADER & PRICING STRUCTURE ---
  // Top Banner
  doc.setFillColor(30, 27, 24);
  doc.rect(0, 0, pageWidth, 75, 'F');
  doc.setFillColor(217, 119, 6);
  doc.rect(0, 75, pageWidth, 5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PULPACRAFT MRP · REPORTE DE ESTIMACIÓN DE COSTOS & PRECIOS', margin, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(214, 211, 209);
  doc.text('Mermeladas Artesanales del Valle C.A. · RIF: J-40899231-0 · Zona Ind. El Valle, Miranda', margin, 48);
  doc.text(`Tasa Oficial BCV: Bs. ${formatVeNumber(rate, 2)} / USD  |  Fecha: ${new Date().toLocaleDateString('es-VE')}  |  Moneda: ${data.currencyMode}`, margin, 60);

  // Badge on the right
  doc.setFillColor(217, 119, 6);
  doc.roundedRect(pageWidth - margin - 150, 14, 150, 50, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('ESTIMACIÓN MTO', pageWidth - margin - 75, 28, { align: 'center' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(`TANDA ${data.productionKilosBase} KG`, pageWidth - margin - 75, 42, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('HOJA EXCEL OFICIAL', pageWidth - margin - 75, 54, { align: 'center' });

  let y = 95;

  // Key Metric Highlights
  const kpiWidth = (contentWidth - 16) / 3;

  doc.setFillColor(245, 245, 244);
  doc.roundedRect(margin, y, kpiWidth, 48, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('COSTO MP POR 1 KG', margin + 8, y + 16);
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(28, 25, 23);
  doc.text(`${curr} ${formatVeNumber(data.rawMaterialCostPerKg * mult, 2)}`, margin + 8, y + 36);

  doc.setFillColor(245, 245, 244);
  doc.roundedRect(margin + kpiWidth + 8, y, kpiWidth, 48, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text('GASTOS FIJOS POR 1 KG', margin + kpiWidth + 16, y + 16);
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(28, 25, 23);
  doc.text(`${curr} ${formatVeNumber(data.totalFixedPerKg * mult, 2)}`, margin + kpiWidth + 16, y + 36);

  doc.setFillColor(254, 243, 199);
  doc.roundedRect(margin + (kpiWidth + 8) * 2, y, kpiWidth, 48, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(146, 64, 14);
  doc.text('COSTO BASE UNITARIO (1 KG)', margin + (kpiWidth + 8) * 2 + 8, y + 16);
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(180, 83, 9);
  doc.text(`${curr} ${formatVeNumber(data.costPer1kg * mult, 2)}`, margin + (kpiWidth + 8) * 2 + 8, y + 36);

  y += 60;

  // SECTION 1: PRECIOS FINALES SUGERIDOS POR PRESENTACIÓN
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text('1. PRECIOS DE VENTA SUGERIDOS POR PRESENTACIÓN & MARGEN COMERCIAL', margin, y);
  y += 8;

  const pricesHeaders = [
    'Presentación',
    `Costo Final (${curr})`,
    `Margen 20% (${curr})`,
    `Margen 25% (${curr})`,
    `Margen 30% (${curr})`,
    `Margen ${data.customMarginPercent}% (${curr})`,
  ];

  const pricesRows = [
    [
      'Cuñete 20kg (Envase Pote Plástico $5.90)',
      formatVeNumber(data.cuneteFinalCost * mult, 2),
      formatVeNumber(data.cunetePrices.margin20 * mult, 2),
      formatVeNumber(data.cunetePrices.margin25 * mult, 2),
      formatVeNumber(data.cunetePrices.margin30 * mult, 2),
      formatVeNumber(data.cunetePrices.custom * mult, 2),
    ],
    [
      'Caja 20kg (Cartón, Bolsa, Tirro $3.37)',
      formatVeNumber(data.cajaFinalCost * mult, 2),
      formatVeNumber(data.cajaPrices.margin20 * mult, 2),
      formatVeNumber(data.cajaPrices.margin25 * mult, 2),
      formatVeNumber(data.cajaPrices.margin30 * mult, 2),
      formatVeNumber(data.cajaPrices.custom * mult, 2),
    ],
    [
      'Galón 5kg (Envase Galón Plástico $2.61)',
      formatVeNumber(data.galonFinalCost * mult, 2),
      formatVeNumber(data.galonPrices.margin20 * mult, 2),
      formatVeNumber(data.galonPrices.margin25 * mult, 2),
      formatVeNumber(data.galonPrices.margin30 * mult, 2),
      formatVeNumber(data.galonPrices.custom * mult, 2),
    ],
  ];

  autoTable(doc, {
    startY: y,
    head: [pricesHeaders],
    body: pricesRows,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 5, textColor: [41, 37, 36], lineColor: [214, 211, 209] },
    headStyles: { fillColor: [41, 37, 36], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 160 },
      1: { halign: 'right', fontStyle: 'bold' },
      2: { halign: 'right' },
      3: { halign: 'right', fillColor: [254, 243, 199] },
      4: { halign: 'right', fontStyle: 'bold' },
      5: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 18;

  // SECTION 2: MATERIA PRIMA (EXCEL IMAGEN 2)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text('2. DETALLE DE MATERIA PRIMA DIRECTA (TANDA DE PRODUCCIÓN)', margin, y);
  y += 8;

  const matHeaders = [
    'Descripción Insumo',
    `Costo Compra (${curr})`,
    'Presentación',
    `Costo/kg (${curr})`,
    `Costo/g (${curr})`,
    'Cant. Usada',
    `Costo Producción (${curr})`,
  ];

  const matRows = data.rawMaterials.map(rm => [
    rm.description,
    formatVeNumber(rm.costBcv * mult, 2),
    `${rm.presentation} ${rm.presentationUnit}`,
    formatVeNumber(rm.unitCost * mult, 4),
    formatVeNumber(rm.costPerGram * mult, 5),
    `${rm.cantProduction}`,
    formatVeNumber(rm.costPerProduction * mult, 2),
  ]);

  matRows.push([
    `TOTAL MATERIA PRIMA (${data.productionKilosBase} KG PRODUCCIÓN)`,
    '-',
    '-',
    formatVeNumber(data.rawMaterialCostPerKg * mult, 4),
    '-',
    `${data.productionKilosBase} kg`,
    formatVeNumber(data.totalRawMaterialsCost * mult, 2),
  ]);

  autoTable(doc, {
    startY: y,
    head: [matHeaders],
    body: matRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, textColor: [41, 37, 36], lineColor: [214, 211, 209] },
    headStyles: { fillColor: [41, 37, 36], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 140 },
      1: { halign: 'right' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
  });

  // --- PAGE 2: PACKAGING, FIXED EXPENSES, PAYROLL & FORMAL APPROVAL ---
  doc.addPage();
  let y2 = 40;

  doc.setFillColor(30, 27, 24);
  doc.rect(0, 0, pageWidth, 28, 'F');
  doc.setFillColor(217, 119, 6);
  doc.rect(0, 28, pageWidth, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PULPACRAFT MRP · DESGLOSE DE ENVASES, GASTOS FIJOS Y NÓMINA', margin, 18);

  y2 = 45;

  // SECTION 3: ENVASES Y EMPAQUES
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(28, 25, 23);
  doc.text('3. COSTOS DE ENVASES Y EMPAQUES (CUÑETE & CAJA 20KG)', margin, y2);
  y2 += 8;

  const pkgHeaders = ['Tipo de Empaque', 'Componentes del Envase', `Costo Unitario (${curr})`, `Total Empaque (${curr})`];
  const pkgRows = [
    ['Cuñete 20kg', 'Pote 20kg ($5.28) + Etiquetas lote ($0.62)', formatVeNumber(data.totalPackaging20k * mult, 2), formatVeNumber(data.totalPackaging20k * mult, 2)],
    ['Caja 20kg', 'Caja ($2.28) + Tirro ($0.17) + Bolsa ($0.85) + Tirraje ($0.07)', formatVeNumber(data.totalPackagingCaja20k * mult, 2), formatVeNumber(data.totalPackagingCaja20k * mult, 2)],
    ['Galón 5kg', 'Envase plástico galón 5kg con tapa y etiqueta', formatVeNumber(data.totalPackagingGalon * mult, 2), formatVeNumber(data.totalPackagingGalon * mult, 2)],
  ];

  autoTable(doc, {
    startY: y2,
    head: [pkgHeaders],
    body: pkgRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, textColor: [41, 37, 36], lineColor: [214, 211, 209] },
    headStyles: { fillColor: [41, 37, 36], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 100, fontStyle: 'bold' },
      1: { cellWidth: 260 },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
  });

  y2 = (doc as any).lastAutoTable.finalY + 16;

  // SECTION 4: GASTOS FIJOS & NÓMINA (10 TRABAJADORES)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(28, 25, 23);
  doc.text('4. GASTOS FIJOS MENSUALES & PRORRATEO OPERATIVO', margin, y2);
  y2 += 8;

  const feHeaders = ['Concepto Gasto', `Monto Mensual (${curr})`, 'Días Mes', `Costo Diario (${curr})`, `Costo por 1 KG (${curr})`];
  const feRows = data.fixedExpenses.map(fe => [
    fe.concept,
    formatVeNumber(fe.monthlyAmount * mult, 2),
    fe.workDays,
    formatVeNumber(fe.dailyAmount * mult, 2),
    formatVeNumber(fe.costPerKg * mult, 4),
  ]);

  feRows.push([
    'TOTAL GASTOS FIJOS',
    formatVeNumber(data.totalFixedMonthly * mult, 2),
    data.workDays,
    formatVeNumber(data.totalFixedDaily * mult, 2),
    formatVeNumber(data.totalFixedPerKg * mult, 4),
  ]);

  autoTable(doc, {
    startY: y2,
    head: [feHeaders],
    body: feRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, textColor: [41, 37, 36], lineColor: [214, 211, 209] },
    headStyles: { fillColor: [41, 37, 36], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 180, fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
  });

  y2 = (doc as any).lastAutoTable.finalY + 14;

  // SECTION 5: NÓMINA DE 10 TRABAJADORES
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(28, 25, 23);
  doc.text('Desglose de Mano de Obra Directa (10 Trabajadores de la Hoja)', margin, y2);
  y2 += 6;

  const workerCols = [
    'Hermes ($100)',
    'Denis ($93.35)',
    'Daniela ($100)',
    'JEREMY ($93.35)',
    'JACOB ($93.35)',
    'VIGILANTE 1 ($60)',
    'VIGILANTE 2 ($60)',
    'Jose Alberto ($93.35)',
    'Luis ($110)',
    'Xavi ($100)',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(87, 83, 78);
  doc.text(
    `Personal: ${workerCols.join(' · ')} | Total Semanal: $903.40 | Proyección Mensual (4 sem): $3,613.60`,
    margin,
    y2 + 8,
    { maxWidth: contentWidth }
  );

  y2 += 24;

  // Commercial Terms & Conditions Box
  doc.setFillColor(245, 245, 244);
  doc.setDrawColor(231, 229, 228);
  doc.roundedRect(margin, y2, contentWidth, 54, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(68, 64, 60);
  doc.text('CONDICIONES COMERCIALES & POLÍTICA DE DESPACHO MAKE-TO-ORDER (MTO):', margin + 10, y2 + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(87, 83, 78);
  doc.text(
    '• Producción contra pedido: tiempo de entrega estimado de 3 a 5 días hábiles a partir de la confirmación de la orden.',
    margin + 10,
    y2 + 26
  );
  doc.text(
    '• Validez de la cotización: 15 días continuos. Precios pagaderos en USD o en Bolívares convertidos a la tasa oficial BCV del día de facturación/pago.',
    margin + 10,
    y2 + 37
  );
  doc.text(
    '• Calidad garantizada: Grados Brix 78° controlados en paila, pulpa criolla seleccionada y registro sanitario vigente.',
    margin + 10,
    y2 + 48
  );

  y2 += 68;

  // Signatures / Acceptance Block
  const sigW = (contentWidth - 24) / 2;
  doc.setDrawColor(168, 162, 158);
  doc.setLineWidth(0.8);
  doc.line(margin, y2 + 38, margin + sigW, y2 + 38);
  doc.line(margin + sigW + 24, y2 + 38, margin + sigW * 2 + 24, y2 + 38);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(41, 37, 36);
  doc.text('ELABORADO POR GERENCIA DE COSTOS', margin + sigW / 2, y2 + 48, { align: 'center' });
  doc.text('ACEPTACIÓN CONFORME / CLIENTE', margin + sigW + 24 + sigW / 2, y2 + 48, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text('PulpaCraft MRP · Mermeladas Artesanales del Valle C.A.', margin + sigW / 2, y2 + 58, { align: 'center' });
  doc.text('Firma, Sello de la Empresa y RIF', margin + sigW + 24 + sigW / 2, y2 + 58, { align: 'center' });

  // Footers on both pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(231, 229, 228);
    doc.line(margin, pageHeight - 20, pageWidth - margin, pageHeight - 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(168, 162, 158);
    doc.text('PulpaCraft MRP · Reporte Oficial de Estimación de Costos & Precios MTO', margin, pageHeight - 10);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
  }

  const filename = `Estimacion_Costos_Mermeladas_${data.currencyMode}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

