import { Prisma } from '@prisma/client';
import { bankOutstanding, isAllocatableCredit } from './bank-outstanding.js';

describe('bankOutstanding', () => {
  it.each([
    ['120', ['20'], ['30', '10'], '60'],
    ['120', ['20'], ['120'], '0'],
  ] as const)(
    'deducts credits and active settlements and floors the balance at zero',
    (gross, credits, payments, expected) => {
      expect(
        bankOutstanding(
          new Prisma.Decimal(gross),
          credits.map((amount) => new Prisma.Decimal(amount)),
          payments.map((amount) => new Prisma.Decimal(amount)),
        ).toString(),
      ).toBe(expected);
    },
  );

  it.each([
    ['EUR', true, '100', true],
    ['USD', true, '100', false],
    ['EUR', false, '100', false],
    ['EUR', true, '0', false],
  ] as const)(
    'checks eligibility for %s, credit=%s, amount=%s',
    (currency, is_credit, amount, expected) => {
      expect(
        isAllocatableCredit({
          currency,
          is_credit,
          amount: new Prisma.Decimal(amount),
        }),
      ).toBe(expected);
    },
  );
});
