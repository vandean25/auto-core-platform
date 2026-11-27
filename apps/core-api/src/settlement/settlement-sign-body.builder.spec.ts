import { PaymentMethod, Prisma } from '@prisma/client';
import {
  buildCancellationSignRequestBody,
  buildNormalSignRequestBody,
} from './settlement-sign-body.builder.js';

describe('settlement sign bodies', () => {
  it('uses fixture metadata keys only on NORMAL bodies', () => {
    const body = buildNormalSignRequestBody({
      invoiceId: '00000000-0000-4000-8000-0000000000d1',
      invoiceNumber: 'RE-2026-0101',
      paymentId: '00000000-0000-4000-8000-0000000000e1',
      grossAmount: new Prisma.Decimal('120.00'),
      method: PaymentMethod.CASH,
    });
    expect(body.metadata).toEqual({
      acp_invoice_id: '00000000-0000-4000-8000-0000000000d1',
      acp_invoice_no: 'RE-2026-0101',
      acp_payment_id: '00000000-0000-4000-8000-0000000000e1',
    });
  });

  it('uses fixture metadata keys only on CANCELLATION bodies', () => {
    const body = buildCancellationSignRequestBody({
      invoiceId: '00000000-0000-4000-8000-0000000000d1',
      invoiceNumber: 'RE-2026-0101',
      paymentId: '00000000-0000-4000-8000-0000000000e1',
      grossAmount: new Prisma.Decimal('120.00'),
      method: PaymentMethod.CASH,
      originalReceiptId: '11111111-2222-4333-8444-555555555555',
    });
    expect(body.metadata).toEqual({
      acp_invoice_id: '00000000-0000-4000-8000-0000000000d1',
      acp_invoice_no: 'RE-2026-0101',
      acp_payment_id: '00000000-0000-4000-8000-0000000000e1',
      acp_original_receipt_id: '11111111-2222-4333-8444-555555555555',
    });
    expect(body.metadata).not.toHaveProperty('acp_idempotency_key');
  });

  const baseParams = {
    invoiceId: '00000000-0000-4000-8000-0000000000d1',
    invoiceNumber: 'RE-2026-0101',
    paymentId: '00000000-0000-4000-8000-0000000000e1',
    method: PaymentMethod.CASH,
  };

  it('keeps the NORMAL body for an invoice without credit note byte-identical to the pre-AUT-1069 shape', () => {
    const body = buildNormalSignRequestBody({
      ...baseParams,
      grossAmount: new Prisma.Decimal('120.00'),
    });
    expect(JSON.stringify(body)).toBe(
      '{"receipt_type":"NORMAL","schema":{"standard_v1":{"amounts_per_vat_rate":[{"vat_rate":"STANDARD","amount":"120.00"}],"amounts_per_payment_type":[{"payment_type":"CASH","amount":"120.00","currency_code":"EUR"}],"line_items":[{"quantity":"1","text":"Rechnung RE-2026-0101","price_per_unit":"120.00"}]}},"metadata":{"acp_invoice_id":"00000000-0000-4000-8000-0000000000d1","acp_invoice_no":"RE-2026-0101","acp_payment_id":"00000000-0000-4000-8000-0000000000e1"}}',
    );
  });

  it('signs the collected (reduced) amount and the cancellation negates exactly that amount', () => {
    const collected = new Prisma.Decimal('100.00');
    const normal = JSON.stringify(
      buildNormalSignRequestBody({ ...baseParams, grossAmount: collected }),
    );
    const cancellation = JSON.stringify(
      buildCancellationSignRequestBody({
        ...baseParams,
        grossAmount: collected,
        originalReceiptId: '11111111-2222-4333-8444-555555555555',
      }),
    );
    expect(normal).toContain('"amount":"100.00"');
    expect(normal).not.toContain('120.00');
    expect(cancellation).toContain('"amount":"-100.00"');
    expect(cancellation).not.toContain('120.00');
  });
});
