import { createHash } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';

export type InvoicePdfPrismaClient = {
  client: Pick<
    PrismaService['client'],
    'invoice' | 'invoiceBrandAssetReference'
  >;
};

export type AssetMetadata = {
  bucket: string | null;
  object_key: string | null;
  object_generation: string | null;
  sha256: string | null;
  detected_mime_type: string | null;
  pixel_width: number | null;
  pixel_height: number | null;
};

export type InvoiceBrandingLogo = {
  asset_id: string;
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
  mime_type: string;
  width: number;
  height: number;
};

export function brandRenderInputUnavailable(
  message = 'Frozen branding or archive evidence is unavailable.',
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
    message,
  });
}

export function isBrandedSnapshot(
  snapshot: unknown,
): snapshot is InvoiceSnapshot {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    'template_version' in snapshot &&
    snapshot.template_version === INVOICE_BRANDED_TEMPLATE_VERSION
  );
}

export function verifyFrozenAssetMetadata(
  asset: AssetMetadata | null | undefined,
  logo: InvoiceBrandingLogo,
): boolean {
  if (!asset) return false;
  const checks: [unknown, unknown][] = [
    [asset.bucket, logo.bucket],
    [asset.object_key, logo.key],
    [asset.object_generation, logo.generation],
    [asset.sha256, logo.sha256],
    [asset.detected_mime_type, logo.mime_type],
    [asset.pixel_width, logo.width],
    [asset.pixel_height, logo.height],
  ];
  return checks.every(([actual, expected]) => actual === expected);
}

export function verifyFrozenLogoHash(
  bytes: Buffer,
  expectedSha256: string,
): boolean {
  return createHash('sha256').update(bytes).digest('hex') === expectedSha256;
}


async function findFrozenAsset(
  prisma: InvoicePdfPrismaClient,
  invoice: { id: string; tenant_id: string; legal_entity_id: string },
  assetId: string,
) {
  const reference = await prisma.client.invoiceBrandAssetReference.findFirst({
    where: {
      tenant_id: invoice.tenant_id,
      legal_entity_id: invoice.legal_entity_id,
      invoice_id: invoice.id,
      asset_id: assetId,
    },
    select: {
      asset: {
        select: {
          bucket: true,
          object_key: true,
          object_generation: true,
          sha256: true,
          detected_mime_type: true,
          pixel_width: true,
          pixel_height: true,
        },
      },
    },
  });
  return reference ? reference.asset : null;
}

export async function loadFrozenLogo(
  prisma: InvoicePdfPrismaClient,
  brandingStorage:
    | {
        readGeneration: (
          bucket: string,
          key: string,
          gen: string,
        ) => Promise<Buffer>;
      }
    | undefined,
  invoice: {
    id: string;
    tenant_id: string;
    legal_entity_id: string | null;
  },
  snapshot: InvoiceSnapshot,
): Promise<Buffer | undefined> {
  const logo = snapshot.branding ? snapshot.branding.logo : undefined;
  if (!logo) return undefined;

  if (!invoice.legal_entity_id || !brandingStorage) {
    throw brandRenderInputUnavailable();
  }

  const asset = await findFrozenAsset(
    prisma,
    {
      id: invoice.id,
      tenant_id: invoice.tenant_id,
      legal_entity_id: invoice.legal_entity_id,
    },
    logo.asset_id,
  );

  if (!verifyFrozenAssetMetadata(asset, logo)) {
    throw brandRenderInputUnavailable();
  }

  const bytes = await brandingStorage.readGeneration(
    logo.bucket,
    logo.key,
    logo.generation,
  );
  if (!verifyFrozenLogoHash(bytes, logo.sha256)) {
    throw brandRenderInputUnavailable();
  }
  return bytes;
}
