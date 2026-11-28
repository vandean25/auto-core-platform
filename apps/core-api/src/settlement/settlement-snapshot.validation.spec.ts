import { UnprocessableEntityException } from '@nestjs/common';
import { CreditNoteStatus, PaymentStatus, Prisma } from '@prisma/client';
import { bankOutstanding } from '../bank-reconciliation/bank-outstanding.js';
import { computeInvoiceBalance } from '../finance/receivables/invoice-balance.js';
import { SETTLEMENT_ERROR_CODES } from './settlement.constants.js';
import { resolveSettlementAmount } from './settlement-snapshot.validation.js';

type Fixture = {
  gross: string;
  credits: Array<[CreditNoteStatus, string]>;
  payments: Array<[PaymentStatus, string]>;
};

const FINALIZED = CreditNoteStatus.FINALIZED;
const VOID = CreditNoteStatus.VOID;
const DRAFT = CreditNoteStatus.DRAFT;

function toInput(fixture: Fixture) {
  return {
    total_gross: fixture.gross,
    credit_notes: fixture.credits.map(([status, total_gross]) => ({
      status,
      total_gross,
    })),
    payments: fixture.payments.map(([status, amount]) => ({ status, amount })),
  };
}

describe('resolveSettlementAmount (AUT-1069 cash-desk amount)', () => {
  it.each<[string, Fixture, string]>([
    ['no credit note: full gross', { gross: '120.00', credits: [], payments: [] }, '120.00'],
    [
      'finalized partial credit note: gross minus credit',
      { gross: '120.00', credits: [[FINALIZED, '20.00']], payments: [] },
      '100.00',
    ],
    [
      'draft and void credit notes are ignored',
      {
        gross: '120.00',
        credits: [
          [DRAFT, '50.00'],
          [VOID, '30.00'],
        ],
        payments: [],
      },
      '120.00',
    ],
    [
      'reversed payment does not reduce the amount',
      {
        gross: '120.00',
        credits: [[FINALIZED, '20.00']],
        payments: [[PaymentStatus.REVERSED, '100.00']],
      },
      '100.00',
    ],
    [
      'cent rounding 0.1 + 0.2 style',
      {
        gross: '0.30',
        credits: [
          [FINALIZED, '0.10'],
          [FINALIZED, '0.10'],
        ],
        payments: [],
      },
      '0.10',
    ],
  ])('%s', (_name, fixture, expected) => {
    expect(resolveSettlementAmount(toInput(fixture)).toFixed(2)).toBe(expected);
  });

  it.each<[string, Fixture]>([
    [
      'full credit note',
      { gross: '120.00', credits: [[FINALIZED, '120.00']], payments: [] },
    ],
    [
      'already paid',
      {
        gross: '120.00',
        credits: [],
        payments: [[PaymentStatus.SETTLED_EXTERNAL, '120.00']],
      },
    ],
    [
      'credited plus paid exceeds gross (no refund flow)',
      {
        gross: '120.00',
        credits: [[FINALIZED, '40.00']],
        payments: [[PaymentStatus.SETTLED, '100.00']],
      },
    ],
  ])('refuses with SETTLEMENT_NOTHING_OUTSTANDING: %s', (_name, fixture) => {
    let caught: unknown;
    try {
      resolveSettlementAmount(toInput(fixture));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse()).toMatchObject({
      code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOTHING_OUTSTANDING,
    });
  });

  it('matches bank reconciliation outstanding for the same fixtures (cash == bank)', () => {
    const fixtures: Fixture[] = [
      { gross: '120.00', credits: [[FINALIZED, '20.00']], payments: [] },
      {
        gross: '120.00',
        credits: [
          [FINALIZED, '20.00'],
          [VOID, '50.00'],
        ],
        payments: [[PaymentStatus.REVERSED, '100.00']],
      },
      { gross: '0.30', credits: [[FINALIZED, '0.10']], payments: [] },
    ];
    for (const fixture of fixtures) {
      const bank = bankOutstanding(
        new Prisma.Decimal(fixture.gross),
        fixture.credits
          .filter(([status]) => status === FINALIZED)
          .map(([, amount]) => new Prisma.Decimal(amount)),
        fixture.payments
          .filter(([status]) => status === PaymentStatus.SETTLED)
          .map(([, amount]) => new Prisma.Decimal(amount)),
      );
      expect(resolveSettlementAmount(toInput(fixture)).toFixed(2)).toBe(
        bank.toFixed(2),
      );
      expect(computeInvoiceBalance(toInput(fixture)).outstanding.toFixed(2)).toBe(
        bank.toFixed(2),
      );
    }
  });
});
