import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FiscalReceiptState,
  FiscalReceiptType,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  RksvMode,
  type FiscalRegisterEnv,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import { lockFinanceSettingsAndAssertOpen } from '../finance/fiscal-lock.helpers.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import {
  assertSiteReadAccess,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { SiteContextService } from '../site/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FiskalySignAtProvider } from './fiskaly-sign-at.types.js';
import { FISKALY_SIGN_AT_PROVIDER } from './fiskaly-sign-at.types.js';
import {
  buildCancellationSignRequestBody,
  buildNormalSignRequestBody,
} from './settlement-sign-body.builder.js';
import { assertSettlementInvoiceSlice } from './settlement-snapshot.validation.js';
import { hashSettlementRecordRequest } from './settlement-request-hash.js';
import { SETTLEMENT_ERROR_CODES } from './settlement.constants.js';
import { mapSettlementResponse } from './settlement.mapper.js';
import type { RecordSettlementDto } from './dto/record-settlement.dto.js';
import type { ReconcileSettlementDto } from './dto/record-settlement.dto.js';
import type { CancelFiscalReceiptDto } from './dto/record-settlement.dto.js';
import {
  isDefiniteProviderRejection,
  isProviderHttpSuccess,
  isProviderTransportFailure,
  markCancellationSignedAndReverse,
  markFiscalReceiptRejected,
  markFiscalReceiptSignedAndPaid,
  markFiscalReceiptUnknown,
  assertProductiveReceiptEnv,
  providerErrorCode,
} from './settlement-provider.helpers.js';
import { FISKALY_SIGN_AT_PROVIDER_ID } from './settlement.constants.js';

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(FISKALY_SIGN_AT_PROVIDER)
    private readonly fiskalyProvider: FiskalySignAtProvider,
  ) {}

  async getSettlement(invoiceId: string) {
    const { tenantId, siteId } = await this.resolveScope();
    const invoice = await this.loadInvoiceForSite(tenantId, siteId, invoiceId);
    await this.assertSettlementAccess(tenantId, siteId);
    const payment = await this.prisma.payment.findFirst({
      where: { tenant_id: tenantId, invoice_id: invoiceId },
      orderBy: { createdAt: 'desc' },
      include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
    });
    return mapSettlementResponse(invoice, payment);
  }

  async recordSettlement(invoiceId: string, dto: RecordSettlementDto) {
    const { tenantId, siteId } = await this.resolveScope();
    await this.assertSettlementAccess(tenantId, siteId);
    const requestHash = hashSettlementRecordRequest({
      invoiceId,
      method: dto.method,
      externalReceiptNumber: dto.externalReceiptNumber,
      externalReceiptDate: dto.externalReceiptDate,
    });

    const existingByKey = await this.prisma.payment.findFirst({
      where: { tenant_id: tenantId, idempotency_key: dto.idempotencyKey },
      include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
    });
    if (existingByKey) {
      if (existingByKey.invoice_id !== invoiceId) {
        throw new ConflictException({
          code: SETTLEMENT_ERROR_CODES.IDEMPOTENCY_MISMATCH,
          message:
            'This idempotency key was already used with a different invoice.',
        });
      }
      if (existingByKey.request_hash !== requestHash) {
        throw new ConflictException({
          code: SETTLEMENT_ERROR_CODES.IDEMPOTENCY_MISMATCH,
          message:
            'This idempotency key was already used with a different request body.',
        });
      }
      if (
        existingByKey.status === PaymentStatus.PENDING ||
        existingByKey.status === PaymentStatus.UNKNOWN
      ) {
        const openReceipt = existingByKey.fiscal_receipts.find(
          (receipt) =>
            receipt.state === FiscalReceiptState.PENDING ||
            receipt.state === FiscalReceiptState.UNKNOWN,
        );
        if (openReceipt) {
          await this.syncOpenFiscalReceipt(
            tenantId,
            invoiceId,
            existingByKey,
            openReceipt,
          );
        }
      }
      const invoice = await this.loadInvoiceForSite(
        tenantId,
        siteId,
        invoiceId,
      );
      const refreshed = await this.prisma.payment.findFirstOrThrow({
        where: { id: existingByKey.id, tenant_id: tenantId },
        include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
      });
      return mapSettlementResponse(invoice, refreshed);
    }

    const invoice = await this.loadInvoiceForSite(tenantId, siteId, invoiceId);
    assertSettlementInvoiceSlice(invoice);

    const legalEntity = await this.prisma.legalEntity.findFirstOrThrow({
      where: {
        tenant_id: tenantId,
        id: invoice.legal_entity_id ?? '',
      },
    });

    if (
      legalEntity.rksv_mode === RksvMode.OFF ||
      legalEntity.rksv_mode === RksvMode.UNKNOWN
    ) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.FISCAL_PATH_DISABLED,
        message: 'Fiscal settlement path is disabled for this legal entity.',
      });
    }

    const blocking = await this.prisma.payment.findFirst({
      where: {
        tenant_id: tenantId,
        invoice_id: invoiceId,
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.UNKNOWN,
            PaymentStatus.SETTLED,
            PaymentStatus.SETTLED_EXTERNAL,
          ],
        },
      },
    });
    if (blocking) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
        message:
          'An open or completed settlement already exists for this invoice.',
      });
    }

    const recordedBy = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    if (legalEntity.rksv_mode === RksvMode.REQUIRED_EXTERNAL_KASSE) {
      return this.recordExternalSettlement({
        tenantId,
        invoice,
        dto,
        requestHash,
        recordedByUserId: recordedBy.id,
      });
    }

    return this.recordRksvSettlement({
      tenantId,
      invoice,
      dto,
      requestHash,
      recordedByUserId: recordedBy.id,
    });
  }

  async reconcileSettlement(invoiceId: string, dto: ReconcileSettlementDto) {
    const { tenantId, siteId } = await this.resolveScope();
    await this.assertSettlementAccess(tenantId, siteId);
    const payment = await this.prisma.payment.findFirst({
      where: {
        tenant_id: tenantId,
        invoice_id: invoiceId,
        idempotency_key: dto.idempotencyKey,
      },
      include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) {
      throw new NotFoundException('Settlement attempt not found');
    }
    const openReceipt = payment.fiscal_receipts.find(
      (receipt) =>
        receipt.state === FiscalReceiptState.PENDING ||
        receipt.state === FiscalReceiptState.UNKNOWN,
    );
    if (!openReceipt) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
        message: 'No PENDING or UNKNOWN fiscal receipt to reconcile.',
      });
    }
    await this.syncOpenFiscalReceipt(tenantId, invoiceId, payment, openReceipt);
    const invoice = await this.loadInvoiceForSite(tenantId, siteId, invoiceId);
    const refreshed = await this.prisma.payment.findFirstOrThrow({
      where: { id: payment.id, tenant_id: tenantId },
      include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
    });
    return mapSettlementResponse(invoice, refreshed);
  }

  async cancelFiscalReceipt(
    fiscalReceiptId: string,
    dto: CancelFiscalReceiptDto,
  ) {
    const { tenantId, siteId } = await this.resolveScope();
    await this.assertSettlementAccess(tenantId, siteId);

    const original = await this.prisma.fiscalReceipt.findFirst({
      where: { id: fiscalReceiptId, tenant_id: tenantId },
      include: {
        payment: { include: { invoice: true, fiscal_receipts: true } },
        fiscal_register: true,
      },
    });
    if (!original || !original.payment.invoice.site_id) {
      throw new NotFoundException('Fiscal receipt not found');
    }
    if (original.payment.invoice.site_id !== siteId) {
      throw new NotFoundException('Fiscal receipt not found');
    }
    if (original.receipt_type !== FiscalReceiptType.NORMAL) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
        message: 'Only a NORMAL fiscal receipt can be cancelled.',
      });
    }
    if (original.state !== FiscalReceiptState.SIGNED) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.FISCAL_RECEIPT_UNKNOWN,
        message:
          'Cancellation is not allowed while the original receipt is unfinished.',
      });
    }

    const existingByCancelKey = original.payment.fiscal_receipts.find(
      (receipt) =>
        receipt.receipt_type === FiscalReceiptType.CANCELLATION &&
        (
          receipt.request_body as {
            metadata?: { acp_idempotency_key?: string };
          }
        )?.metadata?.acp_idempotency_key === dto.idempotencyKey,
    );
    if (existingByCancelKey) {
      if (
        existingByCancelKey.state === FiscalReceiptState.PENDING ||
        existingByCancelKey.state === FiscalReceiptState.UNKNOWN
      ) {
        await this.syncOpenFiscalReceipt(
          tenantId,
          original.payment.invoice_id,
          original.payment,
          existingByCancelKey,
        );
      }
      const invoice = await this.loadInvoiceForSite(
        tenantId,
        siteId,
        original.payment.invoice_id,
      );
      const payment = await this.prisma.payment.findFirstOrThrow({
        where: { id: original.payment_id, tenant_id: tenantId },
        include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
      });
      return mapSettlementResponse(invoice, payment);
    }

    const openCancellation = original.payment.fiscal_receipts.find(
      (receipt) =>
        receipt.receipt_type === FiscalReceiptType.CANCELLATION &&
        (receipt.state === FiscalReceiptState.PENDING ||
          receipt.state === FiscalReceiptState.UNKNOWN ||
          receipt.state === FiscalReceiptState.SIGNED),
    );
    if (openCancellation) {
      throw new ConflictException({
        code: SETTLEMENT_ERROR_CODES.CANCELLATION_ALREADY_OPEN,
        message: 'A cancellation is already open for this payment.',
      });
    }

    const register = original.fiscal_register;
    if (!register || register.provider_state !== 'INITIALIZED') {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.FISCAL_REGISTER_MISSING,
        message: 'Fiscal register is not initialized.',
      });
    }

    const providerReceiptId = randomUUID();
    const requestBody = buildCancellationSignRequestBody({
      invoiceId: original.payment.invoice_id,
      invoiceNumber: original.payment.invoice.invoice_number ?? '',
      paymentId: original.payment_id,
      grossAmount: original.payment.amount,
      method: original.payment.method,
      originalReceiptId: original.provider_receipt_id,
    });
    (requestBody.metadata as Record<string, string>).acp_idempotency_key =
      dto.idempotencyKey;

    const allocated = await this.prisma.$transaction(async (tx) => {
      await lockFinanceSettingsAndAssertOpen(
        tx,
        tenantId,
        original.payment.invoice.date,
      );
      await this.lockFiscalRegister(tx, tenantId, register.site_id);
      const receipt = await tx.fiscalReceipt.create({
        data: {
          tenant_id: tenantId,
          payment_id: original.payment_id,
          fiscal_register_id: register.id,
          provider_receipt_id: providerReceiptId,
          receipt_type: FiscalReceiptType.CANCELLATION,
          state: FiscalReceiptState.PENDING,
          request_body: requestBody as Prisma.InputJsonValue,
          original_fiscal_receipt_id: original.id,
        },
      });
      return receipt;
    });

    await this.invokeProviderSign({
      tenantId,
      invoiceId: original.payment.invoice_id,
      paymentId: original.payment_id,
      fiscalReceiptId: allocated.id,
      cashRegisterId: register.provider_cash_register_id,
      providerReceiptId,
      requestBody,
      isCancellation: true,
      registerEnv: register.env,
    });

    const invoice = await this.loadInvoiceForSite(
      tenantId,
      siteId,
      original.payment.invoice_id,
    );
    const payment = await this.prisma.payment.findFirstOrThrow({
      where: { id: original.payment_id, tenant_id: tenantId },
      include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
    });
    return mapSettlementResponse(invoice, payment);
  }

  private async recordExternalSettlement(params: {
    tenantId: string;
    invoice: Prisma.InvoiceGetPayload<object>;
    dto: RecordSettlementDto;
    requestHash: string;
    recordedByUserId: string;
  }) {
    if (!params.dto.externalReceiptNumber || !params.dto.externalReceiptDate) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
        message:
          'External receipt number and date are required for REQUIRED_EXTERNAL_KASSE.',
      });
    }
    if (params.dto.method !== 'CASH' && params.dto.method !== 'CARD') {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
        message: 'Invalid settlement method.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockFinanceSettingsAndAssertOpen(
        tx,
        params.tenantId,
        params.invoice.date,
      );
      await lockSitesAndAssertActive(tx, params.tenantId, [
        params.invoice.site_id!,
      ]);
      const payment = await tx.payment.create({
        data: {
          tenant_id: params.tenantId,
          invoice_id: params.invoice.id,
          site_id: params.invoice.site_id!,
          legal_entity_id: params.invoice.legal_entity_id!,
          recorded_by_user_id: params.recordedByUserId,
          status: PaymentStatus.SETTLED_EXTERNAL,
          method: params.dto.method,
          amount: params.invoice.total_gross,
          currency: 'EUR',
          idempotency_key: params.dto.idempotencyKey,
          request_hash: params.requestHash,
          external_receipt_number: params.dto.externalReceiptNumber,
          external_receipt_date: new Date(params.dto.externalReceiptDate!),
        },
      });
      await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
        id: params.invoice.id,
        tenantId: params.tenantId,
        from: InvoiceStatus.ISSUED,
        to: InvoiceStatus.PAID,
        conflictMessage: 'Invoice was already transitioned by another request',
      });
      return payment;
    });

    const invoice = await this.prisma.invoice.findFirstOrThrow({
      where: { id: params.invoice.id, tenant_id: params.tenantId },
    });
    const payment = await this.prisma.payment.findFirstOrThrow({
      where: { id: result.id, tenant_id: params.tenantId },
      include: { fiscal_receipts: true },
    });
    return mapSettlementResponse(invoice, payment);
  }

  private async recordRksvSettlement(params: {
    tenantId: string;
    invoice: Prisma.InvoiceGetPayload<object>;
    dto: RecordSettlementDto;
    requestHash: string;
    recordedByUserId: string;
  }) {
    if (params.dto.externalReceiptNumber || params.dto.externalReceiptDate) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
        message:
          'External receipt fields are not allowed on the ACP RKSV path.',
      });
    }

    const register = await this.prisma.fiscalRegister.findFirst({
      where: {
        tenant_id: params.tenantId,
        site_id: params.invoice.site_id!,
        provider: FISKALY_SIGN_AT_PROVIDER_ID,
      },
    });
    if (!register || register.provider_state !== 'INITIALIZED') {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.FISCAL_REGISTER_MISSING,
        message: 'An initialized fiscal register is required for this site.',
      });
    }

    const paymentId = randomUUID();
    const providerReceiptId = randomUUID();
    const requestBody = buildNormalSignRequestBody({
      invoiceId: params.invoice.id,
      invoiceNumber: params.invoice.invoice_number ?? '',
      paymentId,
      grossAmount: params.invoice.total_gross,
      method: params.dto.method,
    });

    const allocated = await this.prisma.$transaction(async (tx) => {
      await lockFinanceSettingsAndAssertOpen(
        tx,
        params.tenantId,
        params.invoice.date,
      );
      await this.lockFiscalRegister(tx, params.tenantId, register.site_id);
      const payment = await tx.payment.create({
        data: {
          id: paymentId,
          tenant_id: params.tenantId,
          invoice_id: params.invoice.id,
          site_id: params.invoice.site_id!,
          legal_entity_id: params.invoice.legal_entity_id!,
          recorded_by_user_id: params.recordedByUserId,
          status: PaymentStatus.PENDING,
          method: params.dto.method,
          amount: params.invoice.total_gross,
          currency: 'EUR',
          idempotency_key: params.dto.idempotencyKey,
          request_hash: params.requestHash,
        },
      });
      const fiscalReceipt = await tx.fiscalReceipt.create({
        data: {
          tenant_id: params.tenantId,
          payment_id: payment.id,
          fiscal_register_id: register.id,
          provider_receipt_id: providerReceiptId,
          receipt_type: FiscalReceiptType.NORMAL,
          state: FiscalReceiptState.PENDING,
          request_body: requestBody as Prisma.InputJsonValue,
        },
      });
      return { payment, fiscalReceipt };
    });

    await this.invokeProviderSign({
      tenantId: params.tenantId,
      invoiceId: params.invoice.id,
      paymentId: allocated.payment.id,
      fiscalReceiptId: allocated.fiscalReceipt.id,
      cashRegisterId: register.provider_cash_register_id,
      providerReceiptId,
      requestBody,
      isCancellation: false,
      registerEnv: register.env,
    });

    const invoice = await this.prisma.invoice.findFirstOrThrow({
      where: { id: params.invoice.id, tenant_id: params.tenantId },
    });
    const payment = await this.prisma.payment.findFirstOrThrow({
      where: { id: allocated.payment.id, tenant_id: params.tenantId },
      include: { fiscal_receipts: { orderBy: { createdAt: 'asc' } } },
    });
    return mapSettlementResponse(invoice, payment);
  }

  private async invokeProviderSign(params: {
    tenantId: string;
    invoiceId: string;
    paymentId: string;
    fiscalReceiptId: string;
    cashRegisterId: string;
    providerReceiptId: string;
    requestBody: Record<string, unknown>;
    isCancellation: boolean;
    registerEnv: FiscalRegisterEnv;
  }) {
    const result = await this.fiskalyProvider.signReceipt({
      cashRegisterId: params.cashRegisterId,
      receiptId: params.providerReceiptId,
      body: params.requestBody,
    });

    if (isProviderHttpSuccess(result)) {
      assertProductiveReceiptEnv(params.registerEnv, result.body);
      await this.prisma.$transaction(async (tx) => {
        if (params.isCancellation) {
          await markCancellationSignedAndReverse(tx, {
            tenantId: params.tenantId,
            invoiceId: params.invoiceId,
            paymentId: params.paymentId,
            fiscalReceiptId: params.fiscalReceiptId,
            response: result.body,
            providerHttpStatus: result.status,
            providerRequestId: result.requestId,
          });
        } else {
          await markFiscalReceiptSignedAndPaid(tx, {
            tenantId: params.tenantId,
            invoiceId: params.invoiceId,
            paymentId: params.paymentId,
            fiscalReceiptId: params.fiscalReceiptId,
            response: result.body,
            providerHttpStatus: result.status,
            providerRequestId: result.requestId,
            providerErrorCode: providerErrorCode(result),
          });
        }
      });
      return;
    }

    if (isDefiniteProviderRejection(result)) {
      await this.prisma.$transaction(async (tx) => {
        await markFiscalReceiptRejected(tx, {
          tenantId: params.tenantId,
          paymentId: params.paymentId,
          fiscalReceiptId: params.fiscalReceiptId,
          response: result.kind === 'http' ? result.body : null,
          providerHttpStatus: result.kind === 'http' ? result.status : 400,
          providerRequestId:
            result.kind === 'http' ? result.requestId : undefined,
          providerErrorCode: providerErrorCode(result),
        });
      });
      return;
    }

    if (
      isProviderTransportFailure(result) ||
      (result.kind === 'http' &&
        (result.status >= 500 || result.status === 408))
    ) {
      await this.prisma.$transaction(async (tx) => {
        await markFiscalReceiptUnknown(tx, {
          tenantId: params.tenantId,
          paymentId: params.paymentId,
          fiscalReceiptId: params.fiscalReceiptId,
        });
      });
    }
  }

  private async syncOpenFiscalReceipt(
    tenantId: string,
    invoiceId: string,
    payment: { id: string },
    fiscalReceipt: {
      id: string;
      provider_receipt_id: string;
      request_body: Prisma.JsonValue;
      fiscal_register_id: string | null;
      receipt_type: FiscalReceiptType;
    },
  ) {
    const register = fiscalReceipt.fiscal_register_id
      ? await this.prisma.fiscalRegister.findFirst({
          where: { id: fiscalReceipt.fiscal_register_id, tenant_id: tenantId },
        })
      : null;
    if (!register) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.FISCAL_REGISTER_MISSING,
        message: 'Fiscal register binding is missing.',
      });
    }

    const retrieve = await this.fiskalyProvider.retrieveReceipt({
      cashRegisterId: register.provider_cash_register_id,
      receiptId: fiscalReceipt.provider_receipt_id,
    });

    if (isProviderHttpSuccess(retrieve)) {
      assertProductiveReceiptEnv(register.env, retrieve.body);
      await this.prisma.$transaction(async (tx) => {
        if (fiscalReceipt.receipt_type === FiscalReceiptType.CANCELLATION) {
          await markCancellationSignedAndReverse(tx, {
            tenantId,
            invoiceId,
            paymentId: payment.id,
            fiscalReceiptId: fiscalReceipt.id,
            response: retrieve.body,
            providerHttpStatus: retrieve.status,
            providerRequestId: retrieve.requestId,
          });
        } else {
          await markFiscalReceiptSignedAndPaid(tx, {
            tenantId,
            invoiceId,
            paymentId: payment.id,
            fiscalReceiptId: fiscalReceipt.id,
            response: retrieve.body,
            providerHttpStatus: retrieve.status,
            providerRequestId: retrieve.requestId,
          });
        }
      });
      return;
    }

    if (
      retrieve.kind === 'http' &&
      retrieve.status === 404 &&
      providerErrorCode(retrieve) === 'E_RECEIPT_NOT_FOUND'
    ) {
      const put = await this.fiskalyProvider.signReceipt({
        cashRegisterId: register.provider_cash_register_id,
        receiptId: fiscalReceipt.provider_receipt_id,
        body: fiscalReceipt.request_body as Record<string, unknown>,
      });
      if (isProviderHttpSuccess(put)) {
        assertProductiveReceiptEnv(register.env, put.body);
        const putRequestId = put.requestId;
        await this.prisma.$transaction(async (tx) => {
          if (fiscalReceipt.receipt_type === FiscalReceiptType.CANCELLATION) {
            await markCancellationSignedAndReverse(tx, {
              tenantId,
              invoiceId,
              paymentId: payment.id,
              fiscalReceiptId: fiscalReceipt.id,
              response: put.body,
              providerHttpStatus: put.status,
              providerRequestId: putRequestId,
            });
          } else {
            await markFiscalReceiptSignedAndPaid(tx, {
              tenantId,
              invoiceId,
              paymentId: payment.id,
              fiscalReceiptId: fiscalReceipt.id,
              response: put.body,
              providerHttpStatus: put.status,
              providerRequestId: putRequestId,
            });
          }
        });
      } else if (isDefiniteProviderRejection(put)) {
        await this.prisma.$transaction(async (tx) => {
          await markFiscalReceiptRejected(tx, {
            tenantId,
            paymentId: payment.id,
            fiscalReceiptId: fiscalReceipt.id,
            response: put.kind === 'http' ? put.body : null,
            providerHttpStatus: put.kind === 'http' ? put.status : 400,
            providerRequestId: put.kind === 'http' ? put.requestId : undefined,
            providerErrorCode: providerErrorCode(put),
          });
        });
      } else if (
        isProviderTransportFailure(put) ||
        (put.kind === 'http' && (put.status >= 500 || put.status === 408))
      ) {
        await this.prisma.$transaction(async (tx) => {
          await markFiscalReceiptUnknown(tx, {
            tenantId,
            paymentId: payment.id,
            fiscalReceiptId: fiscalReceipt.id,
          });
        });
      }
      return;
    }

    if (
      retrieve.kind === 'http' &&
      retrieve.status === 404 &&
      providerErrorCode(retrieve) === 'E_CASH_REGISTER_NOT_FOUND'
    ) {
      return;
    }

    if (
      isProviderTransportFailure(retrieve) ||
      (retrieve.kind === 'http' &&
        (retrieve.status >= 500 || retrieve.status === 408))
    ) {
      return;
    }
  }

  private async lockFiscalRegister(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
  ): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- Serialize RKSV signing with tenant-qualified fiscal_registers row lock.
    await tx.$queryRaw`
      SELECT id FROM fiscal_registers
      WHERE tenant_id = ${tenantId} AND site_id = ${siteId}
      FOR UPDATE
    `;
  }

  private async resolveScope(): Promise<{ tenantId: string; siteId: string }> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return { tenantId, siteId };
  }

  private async assertSettlementAccess(tenantId: string, siteId: string) {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
    await assertSiteReadAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
      siteId,
    );
  }

  private async loadInvoiceForSite(
    tenantId: string,
    siteId: string,
    invoiceId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenant_id: tenantId, site_id: siteId },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }
}
