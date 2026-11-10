const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function catalogItemRevisionToJsonInteger(revision: bigint): number {
  if (revision > BigInt(MAX_SAFE) || revision < BigInt(-MAX_SAFE)) {
    throw new Error(
      `catalog_items.revision ${revision.toString()} exceeds JSON safe integer range`,
    );
  }
  return Number(revision);
}
