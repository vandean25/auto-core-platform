import { createHash } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  INSPECTION_CATALOG_SCHEMA_VERSION,
  type CatalogueManifest,
  type CatalogueManifestPosition,
  type CatalogueReferenceRequest,
  type CatalogueResolutionStatus,
} from './inspection-catalog.types.js';

export function entryLocator(position: CatalogueManifestPosition): string {
  return position.entry_id
    ? `${position.position_id}#${position.entry_id}`
    : position.position_id;
}

export function manifestContentSha256(manifest: CatalogueManifest): string {
  const canonical = JSON.stringify({
    schema_version: manifest.schema_version,
    source_kind: manifest.source_kind,
    publisher: manifest.publisher,
    source_uri: manifest.source_uri,
    source_document_id: manifest.source_document_id,
    source_version: manifest.source_version,
    valid_from: manifest.valid_from,
    valid_to: manifest.valid_to,
    coverage: manifest.coverage,
    rights: manifest.rights,
    approval_evidence_ref: manifest.approval_evidence_ref,
    positions: manifest.positions.map((position) => ({
      position_id: position.position_id,
      entry_id: position.entry_id,
      label: position.label,
      allowed_groups: position.allowed_groups,
      vehicle_scope: position.vehicle_scope,
    })),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateManifest(manifest: CatalogueManifest): void {
  if (manifest.schema_version !== INSPECTION_CATALOG_SCHEMA_VERSION) {
    throw new UnprocessableEntityException({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
    });
  }
  if (!manifest.source_version?.trim()) {
    throw new UnprocessableEntityException({
      code: 'INVALID_CATALOG_MANIFEST',
    });
  }
  if (!manifest.valid_from) {
    throw new UnprocessableEntityException({
      code: 'INVALID_CATALOG_MANIFEST',
    });
  }
}

export function parseViennaDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function isDateWithinInterval(
  instant: Date,
  validFrom: Date,
  validTo: Date | null,
): boolean {
  const day = instant.toISOString().slice(0, 10);
  const from = validFrom.toISOString().slice(0, 10);
  if (day < from) {
    return false;
  }
  if (!validTo) {
    return true;
  }
  const to = validTo.toISOString().slice(0, 10);
  return day < to;
}

export function intervalsOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  const aEnd = aTo ?? new Date('9999-12-31T00:00:00.000Z');
  const bEnd = bTo ?? new Date('9999-12-31T00:00:00.000Z');
  return aFrom < bEnd && bFrom < aEnd;
}

export function resolveCatalogueReference(params: {
  manifest: CatalogueManifest;
  request: CatalogueReferenceRequest;
  inspectionTime: Date;
  vehicleClass?: string | null;
  forCurrentUse: boolean;
}): CatalogueResolutionStatus {
  const { manifest, request, inspectionTime, vehicleClass, forCurrentUse } =
    params;

  if (forCurrentUse && inspectionTime > new Date(manifest.recheck_after)) {
    return 'STALE_CATALOG';
  }

  if (
    !isDateWithinInterval(
      inspectionTime,
      parseViennaDate(manifest.valid_from),
      manifest.valid_to ? parseViennaDate(manifest.valid_to) : null,
    )
  ) {
    return 'STALE_CATALOG';
  }

  const position = manifest.positions.find(
    (entry) =>
      entry.position_id === request.position_id &&
      (request.entry_id == null
        ? entry.entry_id == null
        : entry.entry_id === request.entry_id),
  );
  if (!position) {
    return 'UNKNOWN_CODE';
  }

  if (request.entry_id != null && position.entry_id !== request.entry_id) {
    return 'UNKNOWN_CODE';
  }

  if (position.vehicle_scope === 'REQUIRES_SOURCE_REVIEW' && !vehicleClass) {
    return 'OUT_OF_SCOPE';
  }

  if (
    position.vehicle_scope !== 'REQUIRES_SOURCE_REVIEW' &&
    vehicleClass &&
    position.vehicle_scope !== vehicleClass
  ) {
    return 'OUT_OF_SCOPE';
  }

  return 'RESOLVED';
}

export function previewFingerprint(
  manifestDigest: string,
  manifestReference: string,
  siteId: string,
): string {
  return createHash('sha256')
    .update(`${manifestDigest}:${manifestReference}:${siteId}`, 'utf8')
    .digest('hex');
}
