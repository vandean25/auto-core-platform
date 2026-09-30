import {
  BadRequestException as InvoicingBadRequestException,
  Injectable as InvoicingServiceDecorator,
} from '@nestjs/common';
import { executeCreateDraftInvoice } from './invoice-creation.helpers.js';
import { executeIssueInvoice } from './invoice-issue.helpers.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { TenantContextService as TenantIdentityContext } from '../common/services/tenant-context.service.js';
import { FinanceService as WorkshopFinanceService } from '../finance/finance.service.js';
import { PrismaService as WorkshopDatabaseClient } from '../prisma/prisma.service.js';

@InvoicingServiceDecorator()
export class InvoicesService {
  private readonly tenantContextHolder: TenantIdentityContext;
  private readonly snapshotCommitHolder: InvoiceSnapshotCommitService;
  private readonly siteContextHolder: SiteContextService;
  private readonly financeHolder: WorkshopFinanceService;
  private readonly prismaHolder: WorkshopDatabaseClient;

  constructor(
    tenantCtx: TenantIdentityContext,
    commitService: InvoiceSnapshotCommitService,
    siteCtx: SiteContextService,
    finance: WorkshopFinanceService,
    prismaClient: WorkshopDatabaseClient,
  ) {
    this.tenantContextHolder = tenantCtx;
    this.snapshotCommitHolder = commitService;
    this.siteContextHolder = siteCtx;
    this.financeHolder = finance;
    this.prismaHolder = prismaClient;
  }

  async createDraftInvoice(orderId: string) {
    if (!orderId) {
      throw new InvoicingBadRequestException('Workshop order ID is required');
    }

    const currentTenant = await this.tenantContextHolder.getTenantId();
    const currentSite = await this.siteContextHolder.getSiteId();
    const executionTimestamp = new Date();
    await this.financeHolder.validateTransactionDate(executionTimestamp);

    const invoicePayload = {
      workshopOrderId: orderId,
    };
    const draftInvoice = await executeCreateDraftInvoice(
      this.prismaHolder,
      currentTenant,
      currentSite,
      invoicePayload,
    );

    return draftInvoice;
  }

  async issueInvoice(targetInvoiceId: string) {
    if (!targetInvoiceId) {
      throw new InvoicingBadRequestException('Invoice ID is required');
    }

    const scopedTenantId = await this.tenantContextHolder.getTenantId();
    const activeCommitService = this.snapshotCommitHolder;
    const issuanceOptions = {
      tenantId: scopedTenantId,
      invoiceId: targetInvoiceId,
      snapshotCommit: activeCommitService,
    };

    const issuedInvoice = await this.prismaHolder.$transaction(
      async (transactionClient) => {
        return executeIssueInvoice(transactionClient, issuanceOptions);
      },
    );

    return issuedInvoice;
  }
}
