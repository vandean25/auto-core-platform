import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import type { parseDocumentBrandingExtractionResponse } from './document-branding-extraction-response.js';
import { ExtractionFailure } from './document-branding-extraction-worker.errors.js';

const EXTRACTION_LEASE_MS = 120 * 1000;
const PROPOSAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type ClaimedExtraction = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  source_asset_id: string | null;
  createdAt: Date;
};

export async function publishExtractionProposal(params: {
  prisma: PrismaService;
  provider: DocumentBrandingExtractionProvider;
  extraction: ClaimedExtraction;
  tenantId: string;
  legalEntityId: string;
  leaseToken: string;
  logoAssetId: string;
  logo: { bytes: Buffer; width: number; height: number };
  object: { bucket: string; key: string; generation: string };
  proposal: ReturnType<typeof parseDocumentBrandingExtractionResponse>;
  extraWarningCodes: string[];
}): Promise<boolean> {
  const now = new Date();
  const warningCodes = [
    ...new Set([...params.proposal.warningCodes, ...params.extraWarningCodes]),
  ];
  const theme = { ...params.proposal.theme, logoAssetId: params.logoAssetId };
  const providerMetadata = params.provider.getMetadata();
  return params.prisma.$transaction(async (tx) => {
    const entity = await tx.legalEntity.findFirst({
      where: {
        id: params.legalEntityId,
        tenant_id: params.tenantId,
        is_active: true,
      },
      select: { id: true },
    });
    if (!entity) throw new ExtractionFailure('LEGAL_ENTITY_INACTIVE');
    const entityLock = await tx.legalEntity.updateMany({
      where: {
        id: params.legalEntityId,
        tenant_id: params.tenantId,
        is_active: true,
      },
      data: { is_active: true },
    });
    if (entityLock.count !== 1) {
      throw new ExtractionFailure('LEGAL_ENTITY_INACTIVE');
    }
    if (!params.extraction.source_asset_id) {
      throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
    }
    const source = await tx.documentBrandAsset.findFirst({
      where: {
        id: params.extraction.source_asset_id,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        purpose: 'SOURCE',
        state: 'READY',
        expires_at: { gt: now },
      },
      select: { id: true },
    });
    if (!source) throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
    const stillRunning = await tx.documentBrandExtraction.updateMany({
      where: {
        id: params.extraction.id,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        state: 'RUNNING',
        lease_token: params.leaseToken,
      },
      data: { lease_until: new Date(now.getTime() + EXTRACTION_LEASE_MS) },
    });
    if (stillRunning.count !== 1) return false;
    await tx.documentBrandAsset.create({
      data: {
        id: params.logoAssetId,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        purpose: 'LOGO',
        state: 'READY',
        bucket: params.object.bucket,
        object_key: params.object.key,
        object_generation: params.object.generation,
        sha256: createHash('sha256').update(params.logo.bytes).digest('hex'),
        byte_length: params.logo.bytes.byteLength,
        detected_mime_type: 'image/png',
        pixel_width: params.logo.width,
        pixel_height: params.logo.height,
        expires_at: null,
      },
    });
    const completed = await tx.documentBrandExtraction.updateMany({
      where: {
        id: params.extraction.id,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        state: 'RUNNING',
        lease_token: params.leaseToken,
      },
      data: {
        state: 'SUCCEEDED',
        proposal: theme,
        proposal_logo_asset_id: params.logoAssetId,
        warning_codes: warningCodes,
        prompt_version: DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
        provider_id: providerMetadata.providerId,
        model_id: providerMetadata.modelId,
        failure_code: null,
        lease_token: null,
        lease_until: null,
        completed_at: now,
        expires_at: new Date(
          params.extraction.createdAt.getTime() + PROPOSAL_RETENTION_MS,
        ),
      },
    });
    if (completed.count !== 1) {
      throw new Error('Extraction lease changed while publishing its proposal');
    }
    return true;
  });
}
