import { PrismaService } from '../prisma/prisma.service.js';
import { Injectable } from '@nestjs/common';
import { FinanceService } from '../finance/finance.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { executeCreateDraftInvoice } from './invoice-creation.helpers.js';
import { executeIssueInvoice } from './invoice-issue.helpers.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';
import {
  assertRequiredStringId,
  resolveWorkshopInvoiceDraftScope,
  runInvoiceTenantTransaction,
} from './invoice-service-scope.helpers.js';

export type InvoicesServiceDeps = {
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  financeService: FinanceService;
  snapshotCommitService: InvoiceSnapshotCommitService;
  prisma: PrismaService;
};

export async function createWorkshopDraftInvoice(
  deps: InvoicesServiceDeps,
  orderId: string,
) {
  assertRequiredStringId(orderId, 'Workshop order ID');
  const { tenantId, siteId } = await resolveWorkshopInvoiceDraftScope(deps);
  return executeCreateDraftInvoice(deps.prisma, tenantId, siteId, {
    workshopOrderId: orderId,
  });
}

export async function issueTenantInvoice(
  deps: InvoicesServiceDeps,
  targetInvoiceId: string,
) {
  assertRequiredStringId(targetInvoiceId, 'Invoice ID');
  return runInvoiceTenantTransaction(
    deps.prisma,
    deps.tenantContext,
    (transactionClient, scopedTenantId) =>
      executeIssueInvoice(transactionClient, {
        tenantId: scopedTenantId,
        invoiceId: targetInvoiceId,
        snapshotCommit: deps.snapshotCommitService,
      }),
  );
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly snapshotCommitService: InvoiceSnapshotCommitService,
    private readonly siteContext: SiteContextService,
    private readonly financeService: FinanceService,
    private readonly prisma: PrismaService,
  ) {}

  createDraftInvoice(orderId: string) {
    return createWorkshopDraftInvoice(this.deps(), orderId);
  }

  issueInvoice(targetInvoiceId: string) {
    return issueTenantInvoice(this.deps(), targetInvoiceId);
  }

  private deps(): InvoicesServiceDeps {
    return {
      tenantContext: this.tenantContext,
      snapshotCommitService: this.snapshotCommitService,
      siteContext: this.siteContext,
      financeService: this.financeService,
      prisma: this.prisma,
    };
  }
}
