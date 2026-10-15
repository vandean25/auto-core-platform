import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FiscalReceiptState,
  FiscalReceiptType,
  PaymentStatus,
  RksvMode,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import { SettlementService } from './settlement.service.js';
import { hashSettlementRecordRequest } from './settlement-request-hash.js';

describe('SettlementService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const invoiceId = 'invoice-1';

  function createService(prisma: PrismaService) {
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
    } as unknown as TenantContextService;
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue(siteId),
    } as unknown as SiteContextService;
    const provider = new FiskalySignAtFixtureProvider();
    const dashboardRealtime = {
      emitEntityUpdated: jest.fn(),
    };
    return new SettlementService(
      prisma,
      tenantContext,
      siteContext,
      dashboardRealtime as never,
      provider,
    );
  }

  it('loads the invoice before reconcile touches the provider', async () => {
    const openReceipt = {
      id: 'receipt-1',
      provider_receipt_id: '11111111-2222-4333-8444-555555555555',
      request_body: { receipt_type: 'NORMAL' },
      fiscal_register_id: 'register-1',
      receipt_type: FiscalReceiptType.NORMAL,
      state: FiscalReceiptState.PENDING,
    };
    const payment = {
      id: 'payment-1',
      status: PaymentStatus.PENDING,
      method: 'CASH',
      amount: { toFixed: () => '120.00' },
      currency: 'EUR',
      idempotency_key: 'key-1',
      external_receipt_number: null,
      external_receipt_date: null,
      fiscal_receipts: [openReceipt],
    };
    const invoice = {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
    };
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        findFirstOrThrow: jest.fn().mockResolvedValue(payment),
      },
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue({ rksv_mode: RksvMode.REQUIRED_ACP_RKSV }),
      },
      fiscalRegister: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'register-1',
          tenant_id: tenantId,
          legal_entity_id: 'le-1',
          provider_cash_register_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          env: 'TEST',
        }),
      },
    } as unknown as PrismaService;
    const service = createService(prisma);
    jest
      .spyOn(
        service,
        'assertSettlementAccess',
      )
      .mockResolvedValue(undefined);
    const loadInvoice = jest
      .spyOn(service, 'loadInvoiceForSite')
      .mockResolvedValue(invoice);
    const sync = jest
      .spyOn(service, 'syncOpenFiscalReceipt')
      .mockResolvedValue(undefined);

    await service.reconcileSettlement(invoiceId, {
      idempotencyKey: 'key-1',
    });

    expect(sync).toHaveBeenCalledWith(
      tenantId,
      siteId,
      invoice,
      payment,
      openReceipt,
    );
    expect(loadInvoice.mock.invocationCallOrder[0]).toBeLessThan(
      sync.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('returns 404 for reconcile when the invoice is not on the active site', async () => {
    const prisma = {
      payment: { findFirst: jest.fn() },
      legalEntity: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const service = createService(prisma);
    jest
      .spyOn(
        service,
        'assertSettlementAccess',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'loadInvoiceForSite')
      .mockRejectedValue(new NotFoundException('Invoice not found'));

    await expect(
      service.reconcileSettlement(invoiceId, { idempotencyKey: 'key-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('loads the invoice before provider sync on idempotent record replay', async () => {
    const requestHash = hashSettlementRecordRequest({
      invoiceId,
      method: 'CASH',
      amount: '120.00',
      currency: 'EUR',
      mode: RksvMode.REQUIRED_ACP_RKSV,
    });
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          invoice_id: invoiceId,
          status: PaymentStatus.PENDING,
          request_hash: requestHash,
          method: 'CASH',
          amount: { toFixed: () => '120.00' },
          currency: 'EUR',
          idempotency_key: 'key-1',
          external_receipt_number: null,
          external_receipt_date: null,
          fiscal_receipts: [
            {
              id: 'receipt-1',
              state: FiscalReceiptState.PENDING,
              provider_receipt_id: '11111111-2222-4333-8444-555555555555',
              request_body: {},
              fiscal_register_id: 'register-1',
              receipt_type: FiscalReceiptType.NORMAL,
            },
          ],
        }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'payment-1',
          status: PaymentStatus.PENDING,
          method: 'CASH',
          amount: { toFixed: () => '120.00' },
          currency: 'EUR',
          idempotency_key: 'key-1',
          external_receipt_number: null,
          external_receipt_date: null,
          fiscal_receipts: [],
        }),
      },
      legalEntity: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          rksv_mode: RksvMode.REQUIRED_ACP_RKSV,
        }),
      },
    } as unknown as PrismaService;
    const service = createService(prisma);
    const invoice = {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
      total_gross: { toFixed: () => '120.00' },
      currency: 'EUR',
    };
    jest.spyOn(service, 'assertSettlementAccess').mockResolvedValue(undefined);
    const loadInvoice = jest
      .spyOn(service, 'loadInvoiceForSite')
      .mockResolvedValue(invoice);
    const sync = jest
      .spyOn(service, 'syncOpenFiscalReceipt')
      .mockResolvedValue(undefined);

    await service.recordSettlement(invoiceId, {
      idempotencyKey: 'key-1',
      method: 'CASH',
    });

    expect(loadInvoice.mock.invocationCallOrder[0]).toBeLessThan(
      sync.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('refuses RKSV settlement when the register legal entity mismatches the invoice', async () => {
    const invoice = {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-invoice',
      total_gross: { toFixed: () => '120.00' },
      currency: 'EUR',
      date: new Date(),
    };
    const prisma = {
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
      legalEntity: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          rksv_mode: RksvMode.REQUIRED_ACP_RKSV,
        }),
      },
      fiscalRegister: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'register-1',
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: 'le-other',
          provider_state: 'INITIALIZED',
          provider_cash_register_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          env: 'TEST',
        }),
      },
    } as unknown as PrismaService;
    const service = createService(prisma);

    await expect(
      (service as unknown as {
        recordRksvSettlement: (params: unknown) => Promise<unknown>;
      }).recordRksvSettlement({
        tenantId,
        invoice,
        dto: {
          idempotencyKey: '00000000-0000-4000-8000-0000000000c2',
          method: 'CASH',
        },
        requestHash: 'hash',
        recordedByUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
