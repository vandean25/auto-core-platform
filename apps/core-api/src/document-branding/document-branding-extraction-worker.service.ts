import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROVIDER,
  DisabledDocumentBrandingExtractionProvider,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import { withSpan } from '../common/observability/trace.js';
import { runExtractionWorkerAttempt } from './document-branding-extraction-worker.attempt.js';

const EXTRACTION_LEASE_MS = 120 * 1000;

@Injectable()
export class DocumentBrandingExtractionWorkerService {
  private readonly logger = new Logger(
    DocumentBrandingExtractionWorkerService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly pdfParser: DocumentBrandingPdfParser,
    private readonly imageProcessor: DocumentBrandingExtractionImageProcessor,
    @Optional()
    @Inject(DOCUMENT_BRAND_EXTRACTION_PROVIDER)
    private readonly provider: DocumentBrandingExtractionProvider = new DisabledDocumentBrandingExtractionProvider(),
    @Optional()
    private readonly tasks?: DocumentBrandingExtractionTaskService,
  ) {}

  async process(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    expectedAttemptCount: number,
  ): Promise<void> {
    const claimed = await this.claim(
      extractionId,
      legalEntityId,
      tenantId,
      expectedAttemptCount,
    );
    if (!claimed) return;
    const { providerId, modelId } = this.provider.getMetadata();
    return withSpan(
      'Extract document branding',
      'branding.extract',
      { provider: providerId, model_id: modelId },
      (span) =>
        runExtractionWorkerAttempt({
          extractionId,
          legalEntityId,
          tenantId,
          claimed,
          span,
          prisma: this.prisma,
          storage: this.storage,
          pdfParser: this.pdfParser,
          imageProcessor: this.imageProcessor,
          provider: this.provider,
          tasks: this.tasks,
          logger: this.logger,
          readClaimedExtraction: (id, entityId, tId, leaseToken) =>
            this.readClaimedExtraction(id, entityId, tId, leaseToken),
        }),
    );
  }

  private async claim(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    expectedAttemptCount: number,
  ) {
    const now = new Date();
    const leaseToken = randomUUID();
    const result = await this.prisma.documentBrandExtraction.updateMany({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'QUEUED',
        attempt_count: expectedAttemptCount,
      },
      data: {
        state: 'RUNNING',
        attempt_count: { increment: 1 },
        lease_token: leaseToken,
        lease_until: new Date(now.getTime() + EXTRACTION_LEASE_MS),
      },
    });
    if (result.count !== 1) return null;
    const extraction = await this.prisma.documentBrandExtraction.findFirst({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'RUNNING',
        lease_token: leaseToken,
      },
      select: { attempt_count: true },
    });
    return extraction
      ? { leaseToken, attemptCount: extraction.attempt_count }
      : null;
  }

  private readClaimedExtraction(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    leaseToken: string,
  ) {
    return this.prisma.documentBrandExtraction.findFirst({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'RUNNING',
        lease_token: leaseToken,
      },
    });
  }
}
