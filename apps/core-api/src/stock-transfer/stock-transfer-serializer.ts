import type { Prisma, StockTransferStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

export interface SerializedTransferLine {
  id: string;
  catalogItemId: string;
  requestedQty: string;
  approvedQty: string;
  shippedQty: string;
  receivedQty: string;
  returnedQty: string;
  sourceLocationId: string | null;
  destLocationId: string | null;
}

export interface SerializedStockTransfer {
  id: string;
  transferNumber: string;
  fromSiteId: string;
  fromSiteName: string | null;
  toSiteId: string;
  toSiteName: string | null;
  status: StockTransferStatus;
  version: number;
  requestedByUserId: string;
  approvedByUserId: string | null;
  shippedByUserId: string | null;
  receivedByUserId: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: SerializedTransferLine[];
}

/**
 * Ruling 43: one caller-aware serializer. Source-bin identity is null unless
 * the caller has from-site access; from/to site identity stays visible.
 */
export function serializeStockTransfer(
  transfer: StockTransferWithSitesAndLines,
  options: { includeSourceBin: boolean },
): SerializedStockTransfer {
  const includeSourceBin = options.includeSourceBin;
  return {
    id: transfer.id,
    transferNumber: transfer.transfer_number,
    fromSiteId: transfer.from_site_id,
    fromSiteName: transfer.from_site?.name ?? null,
    toSiteId: transfer.to_site_id,
    toSiteName: transfer.to_site?.name ?? null,
    status: transfer.status,
    version: transfer.version,
    requestedByUserId: transfer.requested_by_user_id,
    approvedByUserId: transfer.approved_by_user_id,
    shippedByUserId: transfer.shipped_by_user_id,
    receivedByUserId: transfer.received_by_user_id,
    rejectReason: transfer.reject_reason,
    cancelReason: transfer.cancel_reason,
    createdAt: transfer.createdAt,
    updatedAt: transfer.updatedAt,
    lines: transfer.lines.map((line) => ({
      id: line.id,
      catalogItemId: line.catalog_item_id,
      requestedQty: line.requested_qty.toString(),
      approvedQty: line.approved_qty.toString(),
      shippedQty: line.shipped_qty.toString(),
      receivedQty: line.received_qty.toString(),
      returnedQty: line.returned_qty.toString(),
      sourceLocationId: includeSourceBin ? line.source_location_id : null,
      destLocationId: line.dest_location_id,
    })),
  };
}

type TransferRow = {
  id: string;
  transfer_number: string;
  from_site_id: string;
  to_site_id: string;
  status: StockTransferStatus;
  version: number;
  requested_by_user_id: string;
  approved_by_user_id: string | null;
  shipped_by_user_id: string | null;
  received_by_user_id: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  createdAt: Date;
  updatedAt: Date;
  from_site: { name: string } | null;
  to_site: { name: string } | null;
  lines: Array<{
    id: string;
    catalog_item_id: string;
    source_location_id: string | null;
    dest_location_id: string | null;
    requested_qty: Prisma.Decimal;
    approved_qty: Prisma.Decimal;
    shipped_qty: Prisma.Decimal;
    received_qty: Prisma.Decimal;
    returned_qty: Prisma.Decimal;
  }>;
};

export type StockTransferWithSitesAndLines = TransferRow;

/**
 * Ruling 30/43: idempotent replays re-serialize the stored first response
 * through the same caller-aware redaction instead of returning
 * `response_body` raw.
 */
export function redactStoredCommandResponse<T extends SerializedStockTransfer>(
  stored: T,
  includeSourceBin: boolean,
): T {
  if (includeSourceBin) {
    return stored;
  }
  return {
    ...stored,
    lines: stored.lines.map((line) => ({
      ...line,
      sourceLocationId: null,
    })),
  };
}

/**
 * Ruling 30: canonical request hash for durable receive/return idempotency.
 * Line order is normalized so a retried identical body hashes equal.
 */
export function hashCommandRequest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const elements = value.map(canonicalize).sort();
    return `[${elements.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
