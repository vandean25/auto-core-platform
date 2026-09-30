import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import * as ops from './vehicle-purchase.helpers.js';
import type { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto.js';
import type { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto.js';

@Injectable()
export class VehiclePurchaseService {
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly siteContext: SiteContextService;
  private readonly ledger: VehicleLedgerService;

  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    siteContext: SiteContextService,
    ledger: VehicleLedgerService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.ledger = ledger;
  }

  private async currentScope() {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  async create(dto: CreateVehiclePurchaseDto) {
    const { tenantId, siteId } = await this.currentScope();
    return ops.executeCreatePurchaseFlow({
      prisma: this.prisma,
      tenantId,
      siteId,
      dto,
    });
  }

  async findAll(page = 1, limit = 25, search?: string) {
    const { tenantId, siteId } = await this.currentScope();
    return ops.executeFindAllPurchases(
      this.prisma,
      tenantId,
      siteId,
      page,
      limit,
      search,
    );
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    return ops.executeFindOnePurchase(
      this.prisma,
      tenantId,
      authorizedSiteIds,
      id,
    );
  }

  async updateDraft(id: string, dto: PatchVehiclePurchaseDto) {
    const { tenantId, siteId } = await this.currentScope();
    const purchase = await this.findOne(id);
    return ops.executeDraftUpdateFlow({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      tenantId,
      siteId,
      id,
      purchase,
      dto,
    });
  }

  async receive(id: string) {
    const { tenantId, siteId } = await this.currentScope();
    return this.prisma.$transaction((tx) =>
      ops.executeReceivePurchaseTx({
        tx,
        tenantId,
        siteId,
        id,
        appendLedger: (params) => this.ledger.append(params, tx),
      }),
    );
  }

  async cancel(id: string) {
    const { tenantId, siteId } = await this.currentScope();
    await ops.executeCancelDraftPurchase(this.prisma, tenantId, siteId, id);
    return this.findOne(id);
  }

  async remove(id: string) {
    const { tenantId, siteId } = await this.currentScope();
    return ops.executeRemovePurchaseFlow(this.prisma, tenantId, siteId, id);
  }
}
