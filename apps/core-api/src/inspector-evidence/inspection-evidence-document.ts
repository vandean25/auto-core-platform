const SYNTH_PREFIX = 'SYNTH-';

export function assertAuthorizedDocumentRef(
  tenantId: string,
  documentRef: string,
  isProduction: boolean,
): void {
  if (!documentRef || documentRef.length > 128) {
    throw new Error('INVALID_DOCUMENT_REFERENCE');
  }
  if (documentRef.startsWith(SYNTH_PREFIX) && !isProduction) {
    return;
  }
  const expectedPrefix = `tenants/${tenantId}/inspector-evidence/`;
  if (!documentRef.startsWith(expectedPrefix)) {
    throw new Error('INVALID_DOCUMENT_REFERENCE');
  }
}
