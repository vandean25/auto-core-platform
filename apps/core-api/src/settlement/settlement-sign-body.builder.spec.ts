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
});
