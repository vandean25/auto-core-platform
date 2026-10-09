/**
 * Archive internals stay server-side. The snapshot holds the seller's and the
 * buyer's identity, and the pointer holds storage coordinates. The sale
 * response keeps the two status fields the page reads.
 */
export type KaufvertragArchiveInternalField =
  | 'kaufvertrag_snapshot'
  | 'kaufvertrag_snapshot_sha256'
  | 'kaufvertrag_archive_bucket'
  | 'kaufvertrag_archive_key'
  | 'kaufvertrag_archive_generation'
  | 'kaufvertrag_archive_sha256';

export function omitKaufvertragArchiveInternals<
  T extends Partial<Record<KaufvertragArchiveInternalField, unknown>>,
>(sale: T): Omit<T, KaufvertragArchiveInternalField> {
  const {
    kaufvertrag_snapshot: snapshot,
    kaufvertrag_snapshot_sha256: snapshotSha256,
    kaufvertrag_archive_bucket: archiveBucket,
    kaufvertrag_archive_key: archiveKey,
    kaufvertrag_archive_generation: archiveGeneration,
    kaufvertrag_archive_sha256: archiveSha256,
    ...response
  } = sale;
  void [
    snapshot,
    snapshotSha256,
    archiveBucket,
    archiveKey,
    archiveGeneration,
    archiveSha256,
  ];
  return response;
}
