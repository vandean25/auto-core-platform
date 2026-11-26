import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CreditNoteStatus,
  FiscalReceiptState,
  FiscalReceiptType,
  PaymentStatus,
  Prisma,
  RksvMode,
} from '@prisma/client';
import { buildInvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import { SETTLEMENT_ERROR_CODES } from './settlement.constants.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import { FiskalySignAtHttpAdapter } from './fiskaly-sign-at-http.adapter.js';
import type { FiskalySignAtProvider } from './fiskaly-sign-at.types.js';
import { SettlementService } from './settlement.service.js';
import { hashSettlementRecordRequest } from './settlement-request-hash.js';

describe('SettlementService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const invoiceId = 'invoice-1';

  function createService(
    prisma: PrismaService,
    options?: { role?: string; provider?: FiskalySignAtProvider },
  ) {
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'fb-1',
        role: options?.role ?? 'OWNER',
      }),
    } as unknown as TenantContextService;
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue(siteId),
    } as unknown as SiteContextService;
    const provider = options?.provider ?? new FiskalySignAtFixtureProvider();
    const dashboardRealtime = {
      emitEntityUpdated: jest.fn(),
    };
    return {
      service: new SettlementService(
        prisma,
        tenantContext,
        siteContext,
        dashboardRealtime as never,
        provider,
      ),
      provider,
      dashboardRealtime,
    };
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
    const { service } = createService(prisma);
    const loadInvoice = jest
      .fn<Promise<unknown>, [string, string, string]>()
      .mockResolvedValue(invoice);
    const sync = jest
      .fn<Promise<void>, unknown[]>()
      .mockResolvedValue(undefined);
    Object.assign(service, {
      assertSettlementAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      loadInvoiceForSite: loadInvoice,
      syncOpenFiscalReceipt: sync,
    });

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
    const { service } = createService(prisma);
    // jest.spyOn cannot target private methods; typed fakes are set on the instance.
    Object.assign(service, {
      assertSettlementAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      loadInvoiceForSite: jest
        .fn<Promise<unknown>, [string, string, string]>()
        .mockRejectedValue(new NotFoundException('Invoice not found')),
    });

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
      creditNote: {
        count: jest.fn().mockResolvedValue(0),
      },
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
    const { service } = createService(prisma);
    const invoice = {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
      total_gross: { toFixed: () => '120.00' },
      currency: 'EUR',
    };
    const loadInvoice = jest
      .fn<Promise<unknown>, [string, string, string]>()
      .mockResolvedValue(invoice);
    const sync = jest
      .fn<Promise<void>, unknown[]>()
      .mockResolvedValue(undefined);
    Object.assign(service, {
      assertSettlementAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      loadInvoiceForSite: loadInvoice,
      syncOpenFiscalReceipt: sync,
    });

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
    const { service } = createService(prisma);

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

  it.each(['SALES', 'TECH'] as const)(
    'denies %s before any provider call on recordSettlement',
    async (role) => {
      const prisma = {} as unknown as PrismaService;
      const { service, provider } = createService(prisma, { role });
      const signSpy = jest.spyOn(provider, 'signReceipt');

      await expect(
        service.recordSettlement(invoiceId, {
          idempotencyKey: 'key-1',
          method: 'CASH',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(signSpy).not.toHaveBeenCalled();
    },
  );

  it('recordSettlement idempotent replay does not allocate a second payment', async () => {
    const requestHash = hashSettlementRecordRequest({
      invoiceId,
      method: 'CASH',
      amount: '120.00',
      currency: 'EUR',
      mode: RksvMode.REQUIRED_ACP_RKSV,
    });
    const existingPayment = {
      id: 'payment-1',
      invoice_id: invoiceId,
      request_hash: requestHash,
      status: PaymentStatus.PENDING,
      method: 'CASH',
      amount: { toFixed: () => '120.00' },
      currency: 'EUR',
      idempotency_key: 'key-1',
      external_receipt_number: null,
      external_receipt_date: null,
      fiscal_receipts: [],
    };
    const prisma = {
      creditNote: {
        count: jest.fn().mockResolvedValue(0),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(existingPayment),
        findFirstOrThrow: jest.fn().mockResolvedValue(existingPayment),
      },
      legalEntity: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          rksv_mode: RksvMode.REQUIRED_ACP_RKSV,
        }),
      },
    } as unknown as PrismaService;
    const { service } = createService(prisma);
    Object.assign(service, {
      assertSettlementAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      loadInvoiceForSite: jest
        .fn<Promise<unknown>, [string, string, string]>()
        .mockResolvedValue({
          id: invoiceId,
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: 'le-1',
          total_gross: { toFixed: () => '120.00' },
          currency: 'EUR',
        }),
    });
    const recordRksvSpy = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    Object.assign(service, { recordRksvSettlement: recordRksvSpy });

    await service.recordSettlement(invoiceId, {
      idempotencyKey: 'key-1',
      method: 'CASH',
    });

    expect(recordRksvSpy).not.toHaveBeenCalled();
  });

  it('recordRksvSettlement leaves one payment when allocation runs twice under register lock', async () => {
    const invoice = {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
      invoice_number: 'RE-1',
      total_gross: { toFixed: () => '120.00' },
      currency: 'EUR',
      date: new Date('2026-01-15'),
    };
    const register = {
      id: 'register-1',
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
      provider_state: 'INITIALIZED',
      provider_cash_register_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      env: 'TEST',
    };
    const allocatedPayments: string[] = [];
    const storedPayment = { id: 'pay-1' };
    const prisma = {
      fiscalRegister: {
        findFirst: jest.fn().mockResolvedValue(register),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          financeSettings: {
            findFirst: jest.fn().mockResolvedValue({ lock_date: null }),
          },
          creditNote: {
            count: jest.fn().mockResolvedValue(0),
          },
          payment: {
            findFirst: jest.fn().mockImplementation(() =>
              allocatedPayments.length > 0 ? storedPayment : null,
            ),
            create: jest.fn().mockImplementation(() => {
              allocatedPayments.push('pay-1');
              return storedPayment;
            }),
          },
          fiscalReceipt: {
            create: jest.fn().mockResolvedValue({ id: 'fr-1' }),
          },
        };
        return callback(tx);
      }),
      invoice: {
        findFirstOrThrow: jest.fn().mockResolvedValue(invoice),
      },
      payment: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'pay-1',
          status: PaymentStatus.PENDING,
          method: 'CASH',
          amount: { toFixed: () => '120.00' },
          currency: 'EUR',
          idempotency_key: '00000000-0000-4000-8000-0000000000c2',
          external_receipt_number: null,
          external_receipt_date: null,
          fiscal_receipts: [],
        }),
      },
    } as unknown as PrismaService;
    const { service } = createService(prisma);
    Object.assign(service, {
      invokeProviderSign: jest
        .fn<Promise<void>, [unknown]>()
        .mockResolvedValue(undefined),
    });

    const params = {
      tenantId,
      invoice,
      dto: {
        idempotencyKey: '00000000-0000-4000-8000-0000000000c2',
        method: 'CASH' as const,
      },
      requestHash: 'hash',
      recordedByUserId: 'user-1',
      rksvMode: RksvMode.REQUIRED_ACP_RKSV,
    };

    await (
      service as unknown as {
        recordRksvSettlement: (p: typeof params) => Promise<unknown>;
      }
    ).recordRksvSettlement(params);

    await expect(
      (
        service as unknown as {
          recordRksvSettlement: (p: typeof params) => Promise<unknown>;
        }
      ).recordRksvSettlement({
        ...params,
        dto: {
          ...params.dto,
          idempotencyKey: '00000000-0000-4000-8000-0000000000c3',
        },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(allocatedPayments).toHaveLength(1);
  });

  it('persists signed:false from the provider once via invokeProviderSign', async () => {
    const provider = new FiskalySignAtFixtureProvider();
    provider.contractServer.configure({
      successBodyTemplate: {
        signed: false,
        hints: ['Sicherheitseinrichtung ausgefallen'],
        _env: 'TEST',
        receipt_number: '99',
      },
    });
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    const { service } = createService(prisma, { provider });
    const fiscalUpdate = jest.fn().mockResolvedValue({
      id: 'receipt-1',
      state: FiscalReceiptState.SIGNED,
      payment: { site_id: siteId },
    });
    (service as unknown as { prisma: PrismaService }).prisma.$transaction = jest
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
        await callback({
          fiscalReceipt: { update: fiscalUpdate },
          payment: { update: jest.fn() },
          invoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        });
      });

    await (
      service as unknown as {
        invokeProviderSign: (params: unknown) => Promise<void>;
      }
    ).invokeProviderSign({
      tenantId,
      siteId,
      invoiceId,
      paymentId: 'payment-1',
      fiscalReceiptId: 'receipt-1',
      cashRegisterId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      providerReceiptId: '11111111-2222-4333-8444-555555555555',
      requestBody: { receipt_type: 'NORMAL' },
      isCancellation: false,
      registerEnv: 'TEST',
    });

    await (
      service as unknown as {
        invokeProviderSign: (params: unknown) => Promise<void>;
      }
    ).invokeProviderSign({
      tenantId,
      siteId,
      invoiceId,
      paymentId: 'payment-1',
      fiscalReceiptId: 'receipt-1',
      cashRegisterId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      providerReceiptId: '11111111-2222-4333-8444-555555555555',
      requestBody: { receipt_type: 'NORMAL' },
      isCancellation: false,
      registerEnv: 'TEST',
    });

    expect(
      provider.contractServer.calls.filter((call) => call.method === 'PUT'),
    ).toHaveLength(1);
    expect(fiscalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          response_body: expect.objectContaining({ signed: false }),
        }),
      }),
    );
  });

  it('rejects recordSettlement with SETTLEMENT_INVOICE_HAS_CREDIT_NOTES before idempotency replay or fiskaly call when finalized credit notes exist', async () => {
    const creditNoteCount = jest.fn().mockResolvedValue(1);
    const paymentFindFirst = jest.fn().mockResolvedValue({
      id: 'payment-1',
      invoice_id: invoiceId,
      status: PaymentStatus.SETTLED,
    });
    const prisma = {
      creditNote: { count: creditNoteCount },
      payment: { findFirst: paymentFindFirst },
      legalEntity: { findFirstOrThrow: jest.fn() },
    } as unknown as PrismaService;
    const { service, provider } = createService(prisma);
    const signSpy = jest.spyOn(provider, 'signReceipt');
    Object.assign(service, {
      assertSettlementAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      loadInvoiceForSite: jest
        .fn<Promise<unknown>, [string, string, string]>()
        .mockResolvedValue({
          id: invoiceId,
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: 'le-1',
          total_gross: { toFixed: () => '120.00' },
          currency: 'EUR',
        }),
    });

    let caught: unknown;
    try {
      await service.recordSettlement(invoiceId, {
        idempotencyKey: 'key-1',
        method: 'CASH',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse()).toMatchObject({
      code: SETTLEMENT_ERROR_CODES.SETTLEMENT_INVOICE_HAS_CREDIT_NOTES,
    });
    expect(creditNoteCount).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        original_invoice_id: invoiceId,
        status: CreditNoteStatus.FINALIZED,
      },
    });
    expect(paymentFindFirst).not.toHaveBeenCalled();
    expect(signSpy).not.toHaveBeenCalled();
  });

  it('rejects inside the write transaction before payment.create when a credit note finalizes after the pre-check', async () => {
    const invoice = {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
      invoice_number: 'RE-2026-0001',
      date: new Date('2026-10-15T10:00:00Z'),
      total_gross: { toFixed: () => '120.00' },
      currency: 'EUR',
    };
    const register = {
      id: 'reg-1',
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: 'le-1',
      provider_state: 'INITIALIZED',
      provider_cash_register_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      env: 'TEST',
    };
    const txCreditNoteCount = jest.fn().mockResolvedValue(1);
    const txPaymentCreate = jest.fn();
    const prisma = {
      fiscalRegister: {
        findFirst: jest.fn().mockResolvedValue(register),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          financeSettings: {
            findFirst: jest.fn().mockResolvedValue({ lock_date: null }),
          },
          creditNote: { count: txCreditNoteCount },
          payment: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: txPaymentCreate,
          },
          fiscalReceipt: { create: jest.fn() },
        };
        return callback(tx);
      }),
    } as unknown as PrismaService;
    const { service, provider } = createService(prisma);
    const signSpy = jest.spyOn(provider, 'signReceipt');

    const params = {
      tenantId,
      invoice,
      dto: {
        idempotencyKey: '00000000-0000-4000-8000-0000000000c4',
        method: 'CASH' as const,
      },
      requestHash: 'hash',
      recordedByUserId: 'user-1',
      rksvMode: RksvMode.REQUIRED_ACP_RKSV,
    };

    let caught: unknown;
    try {
      await (
        service as unknown as {
          recordRksvSettlement: (p: typeof params) => Promise<unknown>;
        }
      ).recordRksvSettlement(params);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse()).toMatchObject({
      code: SETTLEMENT_ERROR_CODES.SETTLEMENT_INVOICE_HAS_CREDIT_NOTES,
    });
    expect(txCreditNoteCount).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        original_invoice_id: invoiceId,
        status: CreditNoteStatus.FINALIZED,
      },
    });
    expect(txPaymentCreate).not.toHaveBeenCalled();
    expect(signSpy).not.toHaveBeenCalled();
  });

  it('rejects settlement with ACP_RKSV_UNAVAILABLE and writes no Payment or FiscalReceipt when live signing is off', async () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: {
        id: invoiceId,
        tax_mode: 'STANDARD',
        global_discount_type: null,
        global_discount_value: null,
        date: new Date('2026-09-01T10:00:00.000Z'),
        due_date: new Date('2026-09-15T10:00:00.000Z'),
        supply_date_from: null,
        supply_date_to: null,
        notes: null,
        total_gross: new Prisma.Decimal('120.00'),
        customer: { type: 'PRIVATE', first_name: 'Erika', last_name: 'Beispiel' },
        vehicle: null,
      } as never,
      seller: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Test GmbH',
        country_iso: 'AT',
        address_street: 'Hauptstraße 1',
        address_line2: null,
        address_zip: '1010',
        address_city: 'Wien',
        tax_number: null,
        vat_id: 'ATU12345678',
        iban: null,
        bic: null,
        bank_name: null,
        email: null,
        phone: null,
        registration_number: null,
        registration_court: null,
        representatives: null,
        payment_terms_days: 14,
        payment_terms_text: null,
      } as never,
      siteId: '00000000-0000-4000-8000-000000000002',
      legalEntityId: '00000000-0000-4000-8000-000000000001',
      lineAllocations: [
        {
          id: 'line-1',
          description: 'Service',
          quantity: new Prisma.Decimal('1'),
          unitPrice: new Prisma.Decimal('100.00'),
          taxRate: new Prisma.Decimal('20.00'),
          lineDiscountType: null,
          lineDiscountValue: null,
          revenueGroupName: null,
          accountingAllocation: {} as never,
        },
      ],
    });
    const transactionMock = jest.fn();
    const prisma = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tm-1', role: 'OWNER' }),
      },
      siteMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      site: {
        findFirst: jest.fn().mockResolvedValue({ id: siteId }),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: invoiceId,
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: 'le-1',
          workshop_order_id: 'wo-1',
          sales_order_id: null,
          is_credit_note: false,
          tax_mode: 'STANDARD',
          status: 'ISSUED',
          total_gross: new Prisma.Decimal('120.00'),
          currency: 'EUR',
          date: new Date('2026-09-01T10:00:00.000Z'),
          snapshot,
        }),
      },
      legalEntity: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'le-1',
          rksv_mode: RksvMode.REQUIRED_ACP_RKSV,
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      creditNote: {
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const { service } = createService(prisma, {
      provider: new FiskalySignAtHttpAdapter(null, false),
    });

    await expect(
      service.recordSettlement(invoiceId, {
        idempotencyKey: '00000000-0000-4000-8000-0000000000c5',
        method: 'CASH',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        code: SETTLEMENT_ERROR_CODES.ACP_RKSV_UNAVAILABLE,
      }),
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

