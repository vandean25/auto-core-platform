import type { Prisma } from '@prisma/client';
import type { StockTransferWithSitesAndLines } from './stock-transfer-serializer.js';

export type LineBinsHost = Pick<StockTransferWithSitesAndLines, 'lines'>;
type TransferLineRow = StockTransferWithSitesAndLines['lines'][number];
type BinRow = { id: string; code: string; name: string };

function collectBinIds(lines: TransferLineRow[]): string[] {
  const binIds = new Set<string>();
  for (const line of lines) {
    if (line.source_location_id) binIds.add(line.source_location_id);
    if (line.dest_location_id) binIds.add(line.dest_location_id);
  }
  return [...binIds];
}

function binAt(binById: Map<string, BinRow>, locationId: string | null) {
  return locationId ? (binById.get(locationId) ?? null) : null;
}

/**
 * Attaches each line's source and destination bin (code + name) in one
 * StorageLocation query. Only the read behind a final response is passed
 * here; reads that feed in-transaction writes stay bin-free so the fixed
 * per-action statement cost grows by this one query alone (AUT-909).
 */
export async function attachLineBins(
  client: Prisma.TransactionClient,
  tenantId: string,
  hosts: LineBinsHost[],
): Promise<void> {
  const lines = hosts.flatMap((host) => host.lines);
  const binIds = collectBinIds(lines);
  if (binIds.length === 0) {
    return;
  }

  const bins = await client.storageLocation.findMany({
    where: { tenant_id: tenantId, id: { in: binIds } },
    select: { id: true, code: true, name: true },
  });
  const binById = new Map<string, BinRow>(bins.map((bin) => [bin.id, bin]));
  for (const line of lines) {
    line.source_location = binAt(binById, line.source_location_id);
    line.dest_location = binAt(binById, line.dest_location_id);
  }
}
