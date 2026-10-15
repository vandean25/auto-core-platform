import { FiscalRegisterEnv, PaymentStatus } from '@prisma/client';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  assertProductiveReceiptEnv,
  markFiscalReceiptUnknown,
} from './settlement-provider.helpers.js';

describe('assertProductiveReceiptEnv', () => {
  it('requires response _env to match the register env', () => {
    expect(() =>
      assertProductiveReceiptEnv(FiscalRegisterEnv.TEST, { _env: 'LIVE' }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertProductiveReceiptEnv(FiscalRegisterEnv.TEST, { _env: 'TEST' }),
    ).not.toThrow();
  });
});

describe('markFiscalReceiptUnknown', () => {
  it('skips payment updates when touchPayment is false', async () => {
    const paymentUpdate = jest.fn();
    await markFiscalReceiptUnknown(
      {
        fiscalReceipt: { update: jest.fn() },
        payment: { update: paymentUpdate },
      } as never,
      {
        tenantId: 'tenant-1',
        paymentId: 'payment-1',
        fiscalReceiptId: 'receipt-1',
        touchPayment: false,
      },
    );
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('updates payment to UNKNOWN by default', async () => {
    const paymentUpdate = jest.fn();
    await markFiscalReceiptUnknown(
      {
        fiscalReceipt: { update: jest.fn() },
        payment: { update: paymentUpdate },
      } as never,
      {
        tenantId: 'tenant-1',
        paymentId: 'payment-1',
        fiscalReceiptId: 'receipt-1',
      },
    );
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { tenant_id_id: { tenant_id: 'tenant-1', id: 'payment-1' } },
      data: { status: PaymentStatus.UNKNOWN },
    });
  });
});
