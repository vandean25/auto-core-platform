import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { runUploadWorkerValidation } from './document-branding-upload-worker-validate.js';

@Injectable()
export class DocumentBrandingUploadWorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly pdfParser: DocumentBrandingPdfParser,
    private readonly decisionHooks: DecisionUseCaseHooksService,
    private readonly requestContext: RequestContextService,
    private readonly decisionLive: DecisionLiveApplyService,
  ) {}

  async validate(assetId: string, tenantId: string) {
    const current = await this.prisma.documentBrandAsset.findFirst({
      where: { id: assetId, tenant_id: tenantId },
    });
    if (!current) {
      throw new NotFoundException('Document branding asset not found');
    }
    if (current.state !== 'QUARANTINED') return { state: current.state };

    return runUploadWorkerValidation({
      assetId,
      tenantId,
      current,
      prisma: this.prisma,
      storage: this.storage,
      pdfParser: this.pdfParser,
      decisionHooks: this.decisionHooks,
      requestContext: this.requestContext,
      decisionLive: this.decisionLive,
    });
  }
}
