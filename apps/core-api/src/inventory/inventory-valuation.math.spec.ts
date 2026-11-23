import { Prisma, TransactionType } from '@prisma/client';
import {
  applyValuationStep,
  computeExtendedValue,
  type ValuationState,
} from './inventory-valuation.math.js';

import Decimal = Prisma.Decimal;

const emptyState = (): ValuationState => ({
  averageUnitCost: null,
  valuedQuantity: new Decimal(0),
});

describe('inventory-valuation.math', () => {
  it('initializes average and valued quantity on first valued receipt', () => {
    const result = applyValuationStep(emptyState(), {
      type: TransactionType.PURCHASE_RECEIPT,
      quantity: 10,
      costBasis: '12.34567',
    });

    expect(result.state.averageUnitCost?.toFixed(4)).toBe('12.3457');
    expect(result.state.valuedQuantity.toFixed(3)).toBe('10.000');
    expect(result.stampedCostBasis?.toFixed(4)).toBe('12.3457');
    expect(result.isUnvaluedGap).toBe(false);
  });

  it('mixes subsequent inbound receipts using 4-decimal moving average', () => {
    const step1 = applyValuationStep(emptyState(), {
      type: TransactionType.PURCHASE_RECEIPT,
      quantity: 2,
      costBasis: 10,
    });
    const step2 = applyValuationStep(step1.state, {
      type: TransactionType.PURCHASE_RECEIPT,
      quantity: 1,
      costBasis: 15,
    });

    // (2 * 10 + 1 * 15) / 3 = 11.666666... -> 11.6667
    expect(step2.state.averageUnitCost?.toFixed(4)).toBe('11.6667');
    expect(step2.state.valuedQuantity.toFixed(3)).toBe('3.000');
  });

  it('reduces valued quantity and stamps current average on outbound sale and workshop consumption', () => {
    const initial: ValuationState = {
      averageUnitCost: new Decimal('15.2500'),
      valuedQuantity: new Decimal('10.000'),
    };

    const sale = applyValuationStep(initial, {
      type: TransactionType.SALE_ISSUE,
      quantity: -3,
      costBasis: null,
    });
    expect(sale.state.averageUnitCost?.toFixed(4)).toBe('15.2500');
    expect(sale.state.valuedQuantity.toFixed(3)).toBe('7.000');
    expect(sale.stampedCostBasis?.toFixed(4)).toBe('15.2500');

    const workshop = applyValuationStep(sale.state, {
      type: TransactionType.WORKSHOP_CONSUMPTION,
      quantity: -2,
      costBasis: '99.00',
    });
    expect(workshop.state.averageUnitCost?.toFixed(4)).toBe('15.2500');
    expect(workshop.state.valuedQuantity.toFixed(3)).toBe('5.000');
    expect(workshop.stampedCostBasis?.toFixed(4)).toBe('15.2500');
  });

  it('freezes the last average at zero and restarts cleanly on the next valued receipt', () => {
    const initial: ValuationState = {
      averageUnitCost: new Decimal('15.0000'),
      valuedQuantity: new Decimal('5.000'),
    };

    // Outbound that crosses below zero clamps valued qty to 0 and freezes avg
    const drained = applyValuationStep(initial, {
      type: TransactionType.SALE_ISSUE,
      quantity: -8,
    });
    expect(drained.state.valuedQuantity.toFixed(3)).toBe('0.000');
    expect(drained.state.averageUnitCost?.toFixed(4)).toBe('15.0000');

    // Next receipt restarts average from the new receipt only
    const restarted = applyValuationStep(drained.state, {
      type: TransactionType.PURCHASE_RECEIPT,
      quantity: 4,
      costBasis: '22.5000',
    });
    expect(restarted.state.valuedQuantity.toFixed(3)).toBe('4.000');
    expect(restarted.state.averageUnitCost?.toFixed(4)).toBe('22.5000');
  });

  it('leaves average and valued quantity unchanged for transfers', () => {
    const initial: ValuationState = {
      averageUnitCost: new Decimal('14.5000'),
      valuedQuantity: new Decimal('12.000'),
    };

    const transferOut = applyValuationStep(initial, {
      type: TransactionType.TRANSFER_OUT,
      quantity: -5,
      costBasis: '14.5000',
    });
    const transferIn = applyValuationStep(transferOut.state, {
      type: TransactionType.TRANSFER_IN,
      quantity: 5,
      costBasis: '14.5000',
    });

    expect(transferIn.state.averageUnitCost?.toFixed(4)).toBe('14.5000');
    expect(transferIn.state.valuedQuantity.toFixed(3)).toBe('12.000');
  });

  it('tolerates unvalued inbound adjustments without inventing a cost', () => {
    const result = applyValuationStep(emptyState(), {
      type: TransactionType.ADJUSTMENT,
      quantity: 5,
      costBasis: null,
    });

    expect(result.state.averageUnitCost).toBeNull();
    expect(result.state.valuedQuantity.toFixed(3)).toBe('0.000');
    expect(result.stampedCostBasis).toBeNull();
    expect(result.isUnvaluedGap).toBe(true);
  });

  it('rounds extended value (quantity * unit cost) to 2 decimals HALF_UP', () => {
    expect(computeExtendedValue('3', '11.6667').toFixed(2)).toBe('35.00');
    expect(computeExtendedValue('2', '10.1255').toFixed(2)).toBe('20.25');
    expect(computeExtendedValue('1', '10.1250').toFixed(2)).toBe('10.13');
  });
});
