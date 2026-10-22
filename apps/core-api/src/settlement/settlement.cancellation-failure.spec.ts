import { ConflictException } from '@nestjs/common';
import { FiscalReceiptState, FiscalReceiptType, RksvMode } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import { SettlementService } from './settlement.service.js';
import { markFiscalReceiptUnknown } from './settlement-provider.helpers.js';

describe('Settlement cancellation failures', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';

  function createService(provider: FiskalySignAtFixtureProvider) {
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
    } as unknown as TenantContextService;
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue(siteId),
    } as unknown as SiteContextService;
    const dashboardRealtime = { emitEntityUpdated: jest.fn() };
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    return new SettlementService(
      prisma,
      tenantContext,
      siteContext,
      dashboardRealtime as never,
      provider,
    );
  }

  it('markFiscalReceiptUnknown with touchPayment false does not update payment', async () => {
    const paymentUpdate = jest.fn();
    const fiscalUpdate = jest.fn();
    const tx = {
      fiscalReceipt: { update: fiscalUpdate },
      payment: { update: paymentUpdate },
    };
    await markFiscalReceiptUnknown(tx as never, {
      tenantId,
      paymentId: 'payment-1',
      fiscalReceiptId: 'receipt-cancel',
      touchPayment: false,
    });
    expect(fiscalUpdate).toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('leaves payment SETTLED and invoice PAID when cancellation sign times out', async () => {
    const provider = new FiskalySignAtFixtureProvider();
    provider.contractServer.configure({ putBehavior: 'timeout' });
    const service = createService(provider);
    const paymentUpdate = jest.fn();
    const fiscalUpdate = jest.fn().mockResolvedValue({
      id: 'cancel-receipt',
      state: FiscalReceiptState.UNKNOWN,
      payment_id: 'payment-1',
    });
    (service as unknown as { prisma: PrismaService }).prisma.$transaction = jest
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
        await callback({
          fiscalReceipt: { update: fiscalUpdate },
          payment: { update: paymentUpdate },
        });
      });

    await (
      service as unknown as {
        invokeProviderSign: (params: unknown) => Promise<void>;
      }
    ).invokeProviderSign({
      tenantId,
      siteId,
      invoiceId: 'invoice-1',
      paymentId: 'payment-1',
      fiscalReceiptId: 'cancel-receipt',
      cashRegisterId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      providerReceiptId: '11111111-2222-4333-8444-555555555555',
      requestBody: { receipt_type: 'CANCELLATION' },
      isCancellation: true,
      registerEnv: 'TEST',
    });

    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(provider.contractServer.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('returns IDEMPOTENCY_MISMATCH when cancel key belongs to another payment', async () => {
    const provider = new FiskalySignAtFixtureProvider();
    const prisma = {
      fiscalReceipt: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'normal-1',
            receipt_type: FiscalReceiptType.NORMAL,
            state: FiscalReceiptState.SIGNED,
            provider_receipt_id: '11111111-2222-4333-8444-555555555555',
            payment: {
              id: 'payment-1',
              invoice_id: 'invoice-1',
              amount: { toFixed: () => '120.00' },
              method: 'CASH',
              fiscal_receipts: [],
              invoice: {
                site_id: siteId,
                invoice_number: 'RE-1',
                date: new Date(),
              },
            },
            payment_id: 'payment-1',
            fiscal_register: {
              id: 'reg-1',
              site_id: siteId,
              legal_entity_id: 'le-1',
              provider_state: 'INITIALIZED',
              provider_cash_register_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
              env: 'TEST',
            },
          })
          .mockResolvedValueOnce({
            id: 'cancel-other',
            payment_id: 'payment-other',
            state: FiscalReceiptState.PENDING,
            payment: {
              id: 'payment-other',
              invoice_id: 'invoice-other',
              invoice: { site_id: 'other-site' },
            },
          }),
      },
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue({ rksv_mode: RksvMode.REQUIRED_ACP_RKSV }),
      },
    } as unknown as PrismaService;
    const service = createService(provider);
    (service as unknown as { prisma: PrismaService }).prisma = prisma;
    Object.assign(service, {
      assertSettlementAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      loadInvoiceForSite: jest
        .fn<Promise<unknown>, [string, string, string]>()
        .mockResolvedValue({
          id: 'invoice-1',
          legal_entity_id: 'le-1',
        }),
    });

    await expect(
      service.cancelFiscalReceipt('normal-1', {
        idempotencyKey: '00000000-0000-4000-8000-0000000000c3',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
