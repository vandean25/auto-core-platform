import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CommonModule } from '../common/common.module.js';
import { EffectiveCapabilitiesService } from '../common/country-pack/effective-capabilities.guard.js';
import { TenantContextMiddleware } from '../common/services/tenant-context.middleware.js';
import { CreditNotePdfService } from '../credit-notes/credit-note-pdf.service.js';
import { DecisionAuditRecorder } from '../decision/decision-audit-recorder.service.js';
import { DecisionCustomerImportApplier } from '../decision/decision-customer-import-apply.service.js';
import { DecisionDocumentSortApplier } from '../decision/decision-document-sort-apply.service.js';
import { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import { DecisionModeResolver } from '../decision/decision-mode-resolver.service.js';
import { DecisionProviderClient } from '../decision/decision-provider-client.service.js';
import { decisionProviderFactory } from '../decision/decision-provider.factory.js';
import { DecisionShadowService } from '../decision/decision-shadow.service.js';
import { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { DocumentBrandingExtractionImageProcessor } from '../document-branding/document-branding-extraction-image-processor.js';
import { DOCUMENT_BRAND_EXTRACTION_PROVIDER } from '../document-branding/document-branding-extraction-provider.js';
import { createDocumentBrandingExtractionProvider } from '../document-branding/document-branding-extraction-provider.factory.js';
import { DocumentBrandingExtractionTaskGuard } from '../document-branding/document-branding-extraction-task.guard.js';
import { DocumentBrandingExtractionTaskService } from '../document-branding/document-branding-extraction-task.service.js';
import { DocumentBrandingExtractionWorkerController } from '../document-branding/document-branding-extraction-worker.controller.js';
import { DocumentBrandingExtractionWorkerService } from '../document-branding/document-branding-extraction-worker.service.js';
import { DocumentBrandingPdfParser } from '../document-branding/document-branding-pdf-parser.js';
import { DocumentBrandingUploadTaskGuard } from '../document-branding/document-branding-upload-task.guard.js';
import { DocumentBrandingUploadWorkerController } from '../document-branding/document-branding-upload-worker.controller.js';
import { DocumentBrandingUploadWorkerService } from '../document-branding/document-branding-upload-worker.service.js';
import { HealthController } from '../health.controller.js';
import { InvoicePdfRenderer } from '../invoices/invoice-pdf.renderer.js';
import { InvoicePdfService } from '../invoices/invoice-pdf.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { SiteContextService as SiteScopedContextService } from '../site/site-context.service.js';
import { KaufvertragPdfArchiveService } from '../vehicle-stock/kaufvertrag/kaufvertrag-pdf.archive.service.js';
import { KaufvertragPdfRenderer } from '../vehicle-stock/kaufvertrag/kaufvertrag-pdf.renderer.js';
import { KaufvertragPdfSnapshotService } from '../vehicle-stock/kaufvertrag/kaufvertrag-pdf.snapshot.service.js';
import { VehicleSaleKaufvertragPdfService } from '../vehicle-stock/kaufvertrag/kaufvertrag-pdf.service.js';
import { WarrantyClaimPdfRenderer } from '../warranty-claim/warranty-claim-pdf.renderer.js';
import { WarrantyClaimPdfService } from '../warranty-claim/warranty-claim-pdf.service.js';
import { WorkshopEstimatePdfRenderer } from '../workshop/workshop-estimate-pdf.renderer.js';
import { WorkshopEstimatePdfService } from '../workshop/workshop-estimate-pdf.service.js';
import { WorkshopPdfRenderer } from '../workshop/workshop-pdf.renderer.js';
import { WorkshopPdfService } from '../workshop/workshop-pdf.service.js';
import { PdfWorkerController } from './pdf-worker.controller.js';
import { WorkerPrismaModule } from './worker-prisma.module.js';

@Module({
  imports: [WorkerPrismaModule, CommonModule],
  controllers: [
    HealthController,
    PdfWorkerController,
    DocumentBrandingUploadWorkerController,
    DocumentBrandingExtractionWorkerController,
  ],
  providers: [
    // PDF renderers & services
    InvoicePdfRenderer,
    InvoicePdfService,
    CreditNotePdfService,
    WorkshopPdfRenderer,
    WorkshopPdfService,
    MechanicMediaStorage,
    WorkshopEstimatePdfRenderer,
    WorkshopEstimatePdfService,
    WarrantyClaimPdfRenderer,
    WarrantyClaimPdfService,
    KaufvertragPdfRenderer,
    KaufvertragPdfSnapshotService,
    KaufvertragPdfArchiveService,
    VehicleSaleKaufvertragPdfService,
    {
      provide: EffectiveCapabilitiesService,
      useValue: { resolve: () => Promise.resolve(null) },
    },
    SiteScopedContextService,
    // Document branding storage & worker services
    DocumentBrandingAssetStorage,
    DocumentBrandingUploadTaskGuard,
    DocumentBrandingUploadWorkerService,
    DocumentBrandingPdfParser,
    DocumentBrandingExtractionTaskGuard,
    DocumentBrandingExtractionTaskService,
    DocumentBrandingExtractionImageProcessor,
    DocumentBrandingExtractionWorkerService,
    {
      provide: DOCUMENT_BRAND_EXTRACTION_PROVIDER,
      useFactory: () => createDocumentBrandingExtractionProvider(),
    },
    AuditService,
    AgentPolicyService,
    AgentActionLogService,
    decisionProviderFactory,
    DecisionShadowService,
    DecisionUseCaseHooksService,
    DecisionModeResolver,
    DecisionProviderClient,
    DecisionAuditRecorder,
    DecisionDocumentSortApplier,
    DecisionLiveApplyService,
    {
      provide: DecisionCustomerImportApplier,
      useValue: {},
    },
    {
      provide: AgentProposalService,
      useValue: {},
    },
  ],
})
export class PdfWorkerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('{*path}');
  }
}
