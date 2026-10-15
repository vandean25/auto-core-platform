import { UnprocessableEntityException } from '@nestjs/common';
import {
  FiscalReceiptState,
  FiscalRegisterEnv,
  InvoiceStatus,
  PaymentStatus,
  type Prisma,
} from '@prisma/client';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import type { FiskalySignAtProviderResult } from './fiskaly-sign-at.types.js';

export function isProviderTransportFailure(
  result: FiskalySignAtProviderResult,
): boolean {
  return result.kind === 'transport';
}

export function isProviderHttpSuccess(
  result: FiskalySignAtProviderResult,
): result is Extract<FiskalySignAtProviderResult, { kind: 'http' }> & {
  status: 200;
  body: Record<string, unknown>;
} {
  return result.kind === 'http' && result.status === 200 && result.body != null;
}

export function isDefiniteProviderRejection(
  result: FiskalySignAtProviderResult,
): boolean {
  return result.kind === 'http' && result.status === 400;
}

export function assertProductiveReceiptEnv(
  registerEnv: FiscalRegisterEnv,
  response: Record<string, unknown>,
): void {
  const responseEnv = response._env;
  if (registerEnv === FiscalRegisterEnv.LIVE && responseEnv === 'TEST') {
    throw new UnprocessableEntityException({
      code: 'FISCAL_RECEIPT_ENV_MISMATCH',
      message:
        'TEST provider receipts cannot be stored as productive LIVE signatures.',
    });
  }
}

export function providerErrorCode(
  result: FiskalySignAtProviderResult,
): string | null {
  if (result.kind !== 'http' || !result.body) return null;
  const code = result.body.code;
  return typeof code === 'string' ? code : null;
}

export async function markFiscalReceiptSignedAndPaid(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    invoiceId: string;
    paymentId: string;
    fiscalReceiptId: string;
    response: Record<string, unknown>;
    providerHttpStatus: number;
    providerRequestId?: string;
    providerErrorCode?: string | null;
  },
): Promise<void> {
  await tx.fiscalReceipt.updateMany({
    where: {
      id: params.fiscalReceiptId,
      tenant_id: params.tenantId,
    },
    data: {
      state: FiscalReceiptState.SIGNED,
      response_body: params.response as Prisma.InputJsonValue,
      provider_http_status: params.providerHttpStatus,
      provider_request_id: params.providerRequestId ?? null,
      provider_error_code: params.providerErrorCode ?? null,
    },
  });

  await tx.payment.updateMany({
    where: { id: params.paymentId, tenant_id: params.tenantId },
    data: { status: PaymentStatus.SETTLED },
  });

  await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
    id: params.invoiceId,
    tenantId: params.tenantId,
    from: InvoiceStatus.ISSUED,
    to: InvoiceStatus.PAID,
    conflictMessage: 'Invoice was already transitioned by another request',
  });
}

export async function markFiscalReceiptRejected(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    paymentId: string;
    fiscalReceiptId: string;
    response: Record<string, unknown> | null;
    providerHttpStatus: number;
    providerRequestId?: string;
    providerErrorCode?: string | null;
  },
): Promise<void> {
  await tx.fiscalReceipt.updateMany({
    where: { id: params.fiscalReceiptId, tenant_id: params.tenantId },
    data: {
      state: FiscalReceiptState.REJECTED,
      response_body: params.response as Prisma.InputJsonValue,
      provider_http_status: params.providerHttpStatus,
      provider_request_id: params.providerRequestId ?? null,
      provider_error_code: params.providerErrorCode ?? null,
    },
  });
  await tx.payment.updateMany({
    where: { id: params.paymentId, tenant_id: params.tenantId },
    data: { status: PaymentStatus.REJECTED },
  });
}

export async function markFiscalReceiptUnknown(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    paymentId: string;
    fiscalReceiptId: string;
  },
): Promise<void> {
  await tx.fiscalReceipt.updateMany({
    where: { id: params.fiscalReceiptId, tenant_id: params.tenantId },
    data: { state: FiscalReceiptState.UNKNOWN },
  });
  await tx.payment.updateMany({
    where: { id: params.paymentId, tenant_id: params.tenantId },
    data: { status: PaymentStatus.UNKNOWN },
  });
}

export async function markCancellationSignedAndReverse(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    invoiceId: string;
    paymentId: string;
    fiscalReceiptId: string;
    response: Record<string, unknown>;
    providerHttpStatus: number;
    providerRequestId?: string;
  },
): Promise<void> {
  await tx.fiscalReceipt.updateMany({
    where: { id: params.fiscalReceiptId, tenant_id: params.tenantId },
    data: {
      state: FiscalReceiptState.SIGNED,
      response_body: params.response as Prisma.InputJsonValue,
      provider_http_status: params.providerHttpStatus,
      provider_request_id: params.providerRequestId ?? null,
    },
  });
  await tx.payment.updateMany({
    where: { id: params.paymentId, tenant_id: params.tenantId },
    data: { status: PaymentStatus.REVERSED },
  });
  await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
    id: params.invoiceId,
    tenantId: params.tenantId,
    from: InvoiceStatus.PAID,
    to: InvoiceStatus.ISSUED,
    conflictMessage: 'Invoice was already transitioned by another request',
  });
}
