/**
 * Datos de la ficha jurídica y de la referencia de capital para el cierre #13.
 *
 * SOLO REFERENCIA: no se persisten en SQLite, no alimentan asientos ni libros
 * y no sustituyen la validación del contador. La fuente es la transcripción
 * proporcionada por el usuario del documento constitutivo (Capítulo II,
 * Cláusula Quinta); queda pendiente el cotejo con la imagen del acta.
 */

export type LegalDraftStatus = 'borrador_referencia';

export interface LegalCapitalDraft {
  /** Cifra literal del acta; sin reconversión ni conversión automática aplicada. */
  amountInActa: number;
  currency: 'BS';
  literal: string;
  reconversionReview: 'pendiente';
  /** Consulta contable para el contador (#13); no es una regla ni un cálculo. */
  reconversionInquiry: string;
}

export interface LegalSharesDraft {
  count: number;
  type: string;
  nominalValueBs: number;
  subscribedAndPaid: boolean;
}

export interface OpeningReferenceDraft {
  accountCode: string;
  accountName: string;
  creditBs: number;
  /** Nunca se contabiliza mientras falten reconversión, fecha de corte y saldos. */
  postingStatus: 'no_registrado';
}

export interface PendingValidationDraft {
  id: string;
  detail: string;
}

export interface LegalEntityDraft {
  status: LegalDraftStatus;
  source: string;
  capital: LegalCapitalDraft;
  shares: LegalSharesDraft;
  statutoryRules: readonly string[];
  openingReference: OpeningReferenceDraft;
  pendingValidation: readonly PendingValidationDraft[];
}

export const LEGAL_ENTITY_DRAFT: LegalEntityDraft = {
  status: 'borrador_referencia',
  source:
    'Documento constitutivo · Capítulo II. Del Capital Social, Distribución y Aportes · Cláusula Quinta (transcripción proporcionada por el usuario; pendiente de cotejo con la imagen)',
  capital: {
    amountInActa: 3_000_000_000,
    currency: 'BS',
    literal: 'Tres Mil Millones de Bolívares',
    reconversionReview: 'pendiente',
    reconversionInquiry:
      'Consulta contable pendiente para el contador (#13), no una regla inventada ni un cálculo automático: verificar el cono monetario vigente a la fecha de otorgamiento del documento para determinar si los Bs. 3.000.000.000,00 del acta (1.000 acciones nominativas × Bs. 3.000.000,00, 100 % suscrito y pagado) corresponden a un cono monetario anterior y cómo deben expresarse o convertirse en los saldos iniciales y estados financieros vigentes. Este registro conserva la cifra literal, sin conversión aplicada.',
  },
  shares: {
    count: 1_000,
    type: 'nominativas',
    nominalValueBs: 3_000_000,
    subscribedAndPaid: true,
  },
  statutoryRules: [
    'Los aumentos de capital requieren Asamblea Extraordinaria.',
    'Los accionistas tienen derecho preferente de suscripción proporcional.',
  ],
  openingReference: {
    accountCode: '3.01',
    accountName: 'Capital Social',
    creditBs: 3_000_000_000,
    postingStatus: 'no_registrado',
  },
  pendingValidation: [
    {
      id: 'reconversion',
      detail:
        'Consultar con el contador el cono monetario y la fecha de otorgamiento del acta (ver aclaración en la ficha); sin conversión automática.',
    },
    {
      id: 'fecha_corte',
      detail: 'Definir la fecha de corte con el contador.',
    },
    {
      id: 'accionistas',
      detail:
        'Incorporar el detalle de accionistas y aportes y cotejar la transcripción con la imagen del acta.',
    },
    {
      id: 'saldos',
      detail:
        'Completar el resto de activos, pasivos y resultados acumulados del asiento inicial.',
    },
    {
      id: 'libro_compras_criterio',
      detail:
        'Validar el criterio del Libro de Compras: se alimenta al pagar la CxP (pago vs. devengo).',
    },
    {
      id: 'cuenta_retenciones_islr',
      detail:
        'Definir la cuenta de control para retenciones de ISLR recibidas de clientes SPE.',
    },
    {
      id: 'tasas_conceptos',
      detail:
        'Validar exentos/8 %, conceptos de ISLR y alícuotas; el catálogo fiscal es solo referencia.',
    },
    {
      id: 'formatos_legales',
      detail:
        'Validar formatos legales, firma, numeración de libro/página y paginación.',
    },
    {
      id: 'saldos_apertura_auxiliares',
      detail:
        'Completar saldos de apertura por cliente, proveedor y banco, y su conciliación.',
    },
  ],
};

/** Comprobación aritmética de la transcripción: acciones × valor nominal = capital del acta. */
export function capitalMatchesShares(draft: LegalEntityDraft = LEGAL_ENTITY_DRAFT): boolean {
  return draft.shares.count * draft.shares.nominalValueBs === draft.capital.amountInActa;
}
