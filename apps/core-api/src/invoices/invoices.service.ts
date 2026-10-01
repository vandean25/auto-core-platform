import { BadRequestException, Injectable } from '@nestjs/common';
import { executeCreateDraftInvoice } from './invoice-creation.helpers.js';
import { executeIssueInvoice } from './invoice-issue.helpers.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly snapshotCommitService: InvoiceSnapshotCommitService,
    private readonly siteContext: SiteContextService,
    private readonly financeService: FinanceService,
    private readonly prisma: PrismaService,
  ) {}

  async createDraftInvoice(orderId: string) {
    if (!orderId) {
      throw new BadRequestException('Workshop order ID is required');
    }

    const currentTenant = await this.tenantContext.getTenantId();
    const currentSite = await this.siteContext.getSiteId();
    const executionTimestamp = new Date();
    await this.financeService.validateTransactionDate(executionTimestamp);

    const invoicePayload = {
      workshopOrderId: orderId,
    };
    const draftInvoice = await executeCreateDraftInvoice(
      this.prisma,
      currentTenant,
      currentSite,
      invoicePayload,
    );

    return draftInvoice;
  }

  async issueInvoice(targetInvoiceId: string) {
    if (!targetInvoiceId) {
      throw new BadRequestException('Invoice ID is required');
    }

    const scopedTenantId = await this.tenantContext.getTenantId();
    const activeCommitService = this.snapshotCommitService;
    const issuanceOptions = {
      tenantId: scopedTenantId,
      invoiceId: targetInvoiceId,
      snapshotCommit: activeCommitService,
    };

    const issuedInvoice = await this.prisma.$transaction(
      async (transactionClient) => {
        return executeIssueInvoice(transactionClient, issuanceOptions);
      },
    );

    return issuedInvoice;
  }
}
