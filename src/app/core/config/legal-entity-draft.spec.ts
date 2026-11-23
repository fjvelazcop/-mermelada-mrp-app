import {describe, expect, it} from 'vitest';
import {LEGAL_ENTITY_DRAFT, capitalMatchesShares} from './legal-entity-draft';

describe('Ficha jurídica en borrador (#13)', () => {
  it('conserva literalmente los datos del acta', () => {
    const draft = LEGAL_ENTITY_DRAFT;

    expect(draft.status).toBe('borrador_referencia');
    expect(draft.capital.amountInActa).toBe(3_000_000_000);
    expect(draft.capital.currency).toBe('BS');
    expect(draft.capital.literal).toBe('Tres Mil Millones de Bolívares');
    expect(draft.capital.reconversionReview).toBe('pendiente');

    expect(draft.shares.count).toBe(1_000);
    expect(draft.shares.type).toBe('nominativas');
    expect(draft.shares.nominalValueBs).toBe(3_000_000);
    expect(draft.shares.subscribedAndPaid).toBe(true);

    expect(draft.statutoryRules).toEqual([
      'Los aumentos de capital requieren Asamblea Extraordinaria.',
      'Los accionistas tienen derecho preferente de suscripción proporcional.',
    ]);
    expect(capitalMatchesShares()).toBe(true);
  });

  it('aclara que la reconversión es consulta contable, sin conversión automática', () => {
    const {capital, openingReference, pendingValidation} = LEGAL_ENTITY_DRAFT;

    expect(capital.amountInActa).toBe(3_000_000_000);
    expect(capital.reconversionInquiry).toContain('cono monetario');
    expect(capital.reconversionInquiry).toContain('fecha de otorgamiento');
    expect(capital.reconversionInquiry).toContain('saldos iniciales y estados financieros vigentes');
    expect(capital.reconversionInquiry).toContain('sin conversión aplicada');
    expect(capital.reconversionInquiry).toContain('no una regla inventada ni un cálculo automático');
    expect(pendingValidation.find((item) => item.id === 'reconversion')?.detail).toContain(
      'sin conversión automática'
    );
    expect(openingReference.postingStatus).toBe('no_registrado');
  });

  it('deja la referencia de apertura sin asiento contable', () => {
    const {openingReference} = LEGAL_ENTITY_DRAFT;

    expect(openingReference.accountCode).toBe('3.01');
    expect(openingReference.accountName).toBe('Capital Social');
    expect(openingReference.creditBs).toBe(3_000_000_000);
    expect(openingReference.postingStatus).toBe('no_registrado');
  });

  it('registra los nueve pendientes de validación con el contador', () => {
    const pending = LEGAL_ENTITY_DRAFT.pendingValidation;

    expect(pending.map((item) => item.id)).toEqual([
      'reconversion',
      'fecha_corte',
      'accionistas',
      'saldos',
      'libro_compras_criterio',
      'cuenta_retenciones_islr',
      'tasas_conceptos',
      'formatos_legales',
      'saldos_apertura_auxiliares',
    ]);
    expect(pending.every((item) => item.detail.trim().length > 0)).toBe(true);
  });
});
