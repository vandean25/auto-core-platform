import { Inject, Injectable } from '@nestjs/common';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import type {
  WorkshopEstimateListResponseDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import type { WorkshopOrderCommunicationsResponseDto } from './dto/workshop-order-communications.dto.js';
import { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';
import { resolveEstimateScope } from './workshop-estimate-scope.js';
import {
  WorkshopEstimatePdfService,
  type WorkshopEstimatePdfRequestResponse,
  type WorkshopEstimatePdfStream,
} from './workshop-estimate-pdf.service.js';
import { loadWorkshopOrderCommunications } from './workshop-estimate-communications.load.js';
import { cloudTasksTargetBaseUrl } from './workshop-estimate-after-send.js';
import {
  readWorkshopEstimate,
  readWorkshopEstimateVersion,
} from './workshop-estimate-read.js';
import { createEstimateForOrderInTx } from './workshop-estimate-create.command.js';
import { createEstimateRevisionInTx } from './workshop-estimate-revision.command.js';
import { sendWorkshopEstimateVersion } from './workshop-estimate-send.command.js';
import { listEstimatesForOrder } from './workshop-estimate-list.command.js';
import { mapEstimateWriteError } from './workshop-estimate-write-errors.js';
import type { EstimateSendOptions } from './workshop-estimate-send.options.js';

@Injectable()
export class WorkshopEstimateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
    @Inject(WorkshopEstimatePdfService)
    private readonly pdf: WorkshopEstimatePdfService,
    @Inject(NotificationOutboxService)
    private readonly outbox: NotificationOutboxService,
    @Inject(NotificationCloudTasksService)
    private readonly wakeUps: NotificationCloudTasksService,
    @Inject(WorkshopEstimateOverrunService)
    private readonly overruns: WorkshopEstimateOverrunService,
  ) {}

  async createForOrder(orderId: string): Promise<WorkshopEstimateResponseDto> {
    const scope = await this.resolveScope();
    const estimateId = await this.prisma
      .$transaction((tx) => createEstimateForOrderInTx(tx, scope, orderId))
      .catch(mapEstimateWriteError);
    return readWorkshopEstimate(this.prisma, this.overruns, scope, estimateId);
  }

  async listForOrder(
    orderId: string,
  ): Promise<WorkshopEstimateListResponseDto> {
    const scope = await this.resolveScope();
    return listEstimatesForOrder(this.prisma, this.overruns, scope, orderId);
  }

  async listCommunicationsForOrder(
    orderId: string,
  ): Promise<WorkshopOrderCommunicationsResponseDto> {
    const scope = await this.resolveScope();
    return loadWorkshopOrderCommunications(this.prisma, scope, orderId);
  }

  async createRevision(
    orderId: string,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const scope = await this.resolveScope();
    const versionId = await this.prisma
      .$transaction((tx) => createEstimateRevisionInTx(tx, scope, orderId))
      .catch(mapEstimateWriteError);
    return readWorkshopEstimateVersion(this.prisma, scope, versionId);
  }

  async getVersion(
    versionId: string,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const scope = await this.resolveScope();
    return readWorkshopEstimateVersion(this.prisma, scope, versionId);
  }

  async sendVersion(
    versionId: string,
    options: EstimateSendOptions = { notifyCustomerByEmail: false },
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const scope = await this.resolveScope();
    return sendWorkshopEstimateVersion(
      {
        prisma: this.prisma,
        tenantContext: this.tenantContext,
        outbox: this.outbox,
        wakeUps: this.wakeUps,
        pdf: this.pdf,
        scope,
      },
      versionId,
      options,
    );
  }

  async requestVersionPdf(
    versionId: string,
  ): Promise<WorkshopEstimatePdfRequestResponse> {
    const scope = await this.resolveScope();
    return this.pdf.requestGeneration(scope, versionId, {
      targetBaseUrl: cloudTasksTargetBaseUrl(),
    });
  }

  async getVersionPdf(versionId: string): Promise<WorkshopEstimatePdfStream> {
    const scope = await this.resolveScope();
    return this.pdf.getPdf(scope, versionId);
  }

  private async resolveScope() {
    return resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
  }
}
