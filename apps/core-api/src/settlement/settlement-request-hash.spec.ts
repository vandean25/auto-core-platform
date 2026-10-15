import { hashSettlementRecordRequest } from './settlement-request-hash.js';

describe('hashSettlementRecordRequest', () => {
  it('includes amount, currency, and mode in the hash', () => {
    const base = hashSettlementRecordRequest({
      invoiceId: 'inv-1',
      method: 'CASH',
      amount: '120.00',
      currency: 'EUR',
      mode: 'REQUIRED_ACP_RKSV',
    });
    const differentAmount = hashSettlementRecordRequest({
      invoiceId: 'inv-1',
      method: 'CASH',
      amount: '119.00',
      currency: 'EUR',
      mode: 'REQUIRED_ACP_RKSV',
    });
    expect(base).not.toEqual(differentAmount);
  });
});
