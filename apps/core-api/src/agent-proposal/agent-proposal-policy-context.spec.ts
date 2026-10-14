import { BadRequestException } from '@nestjs/common';
import { extractPolicyContext } from './agent-proposal-policy-context.js';

describe('extractPolicyContext', () => {
  it('returns an empty context for payloads that are not objects', () => {
    expect(extractPolicyContext(null)).toEqual({});
    expect(extractPolicyContext(['amount_eur', 10])).toEqual({});
  });

  it('prices workshop line items from line_item and propose_line alike', () => {
    const payload = { line_item: { unit_price: 20, quantity: 3 } };

    expect(extractPolicyContext(payload, 'workshop_order.add_line')).toEqual({
      amount_eur: 60,
    });
    expect(extractPolicyContext(payload, 'workshop_order.propose_line')).toEqual(
      { amount_eur: 60 },
    );
  });

  it('reads the amount from the accepted keys and converts cents', () => {
    expect(extractPolicyContext({ amountEur: 12 }, 'customer.update')).toEqual({
      amount_eur: 12,
    });
    expect(
      extractPolicyContext({ amount_cents: 1250 }, 'customer.update'),
    ).toEqual({ amount_eur: 12.5 });
    expect(
      extractPolicyContext(
        { amount: 'not-a-number', amountCents: 500 },
        'customer.update',
      ),
    ).toEqual({ amount_eur: 5 });
  });

  it('ignores non-finite amounts', () => {
    expect(
      extractPolicyContext({ amount_eur: Infinity }, 'customer.update'),
    ).toEqual({});
  });

  it('refuses a negative amount', () => {
    expect(() =>
      extractPolicyContext({ amount_eur: -1 }, 'customer.update'),
    ).toThrow(BadRequestException);
    expect(() =>
      extractPolicyContext({ amount_eur: -1 }, 'customer.update'),
    ).toThrow('Amount cannot be negative');
  });

  it('reads boolean flags from either naming convention', () => {
    expect(
      extractPolicyContext(
        { customerFacing: true, reversible: false, affectsLegalDocument: true },
        'customer.update',
      ),
    ).toEqual({
      customer_facing: true,
      reversible: false,
      affects_legal_document: true,
    });
  });

  it('prefers the snake_case flag when both spellings are present', () => {
    expect(
      extractPolicyContext(
        { customer_facing: false, customerFacing: true },
        'customer.update',
      ),
    ).toEqual({ customer_facing: false });
  });

  it('merges a nested context, with the outer payload taking precedence', () => {
    expect(
      extractPolicyContext(
        {
          reversible: false,
          context: { reversible: true, customer_facing: true },
        },
        'customer.update',
      ),
    ).toEqual({ reversible: false, customer_facing: true });
  });

  it('takes the amount from a nested context when the outer payload has none', () => {
    expect(
      extractPolicyContext({ context: { amount_eur: 7 } }, 'customer.update'),
    ).toEqual({ amount_eur: 7 });
  });
});
