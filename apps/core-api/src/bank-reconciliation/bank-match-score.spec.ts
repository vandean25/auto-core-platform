import { Prisma } from '@prisma/client';
import { scoreBankMatch } from './bank-match-score.js';

const transfer = {
  availableAmount: new Prisma.Decimal(100),
  reference_text: 'Payment RE-2026-123',
  remitter_name: 'Max Muster',
  remitter_iban_last4: '0123',
};
const invoice = { outstanding: new Prisma.Decimal(100), name: 'Muster Max' };

describe('scoreBankMatch', () => {
  it('ranks name and exact amount below an explicit invoice reference', () => {
    const nameMatch = scoreBankMatch(
      transfer,
      { ...invoice, number: 'RE-2026-12' },
      false,
    );
    const referenceMatch = scoreBankMatch(
      transfer,
      { ...invoice, number: 'RE-2026-123' },
      false,
    );
    expect(nameMatch.reasons.map(({ code }) => code)).toEqual([
      'AMOUNT_EXACT',
      'NAME_SIMILAR',
    ]);
    expect(nameMatch.score).toBeLessThan(referenceMatch.score);
  });

  it('weights confirmed remitter history above amount alone', () => {
    const candidate = {
      ...invoice,
      number: 'RE-2026-12',
      name: 'Another Customer',
    };
    const amountMatch = scoreBankMatch(transfer, candidate, false);
    const ibanMatch = scoreBankMatch(transfer, candidate, true);
    expect(ibanMatch.reasons).toContainEqual({
      code: 'IBAN_SEEN_BEFORE',
      value: '0123',
    });
    expect(amountMatch.score).toBeLessThan(ibanMatch.score);
  });
});
