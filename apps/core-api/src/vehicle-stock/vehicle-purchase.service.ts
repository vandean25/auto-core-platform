import { ConflictException, Injectable } from '@nestjs/common';
import { VehicleAcquisitionKind } from '@prisma/client';
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
    assertNotTradeInKind(purchase.acquisition_kind, 'edited');
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
    await this.assertNotTradeInById(tenantId, id, 'cancelled');
    await ops.executeCancelDraftPurchase(this.prisma, tenantId, siteId, id);
    return this.findOne(id);
  }

  async remove(id: string) {
    const { tenantId, siteId } = await this.currentScope();
    await this.assertNotTradeInById(tenantId, id, 'deleted');
    return ops.executeRemovePurchaseFlow(this.prisma, tenantId, siteId, id);
  }

  /** Missing rows fall through so the existing not-found and DRAFT-state errors still apply. */
  private async assertNotTradeInById(
    tenantId: string,
    id: string,
    action: TradeInGuardAction,
  ): Promise<void> {
    const purchase = await this.prisma.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId },
      select: { acquisition_kind: true },
    });
    assertNotTradeInKind(purchase?.acquisition_kind, action);
  }
}

type TradeInGuardAction = 'edited' | 'cancelled' | 'deleted';

/** Trade-in purchases belong to their vehicle sale: the sale sets, changes and removes them. */
function assertNotTradeInKind(
  acquisitionKind: VehicleAcquisitionKind | null | undefined,
  action: TradeInGuardAction,
): void {
  if (acquisitionKind === VehicleAcquisitionKind.TRADE_IN) {
    throw new ConflictException(
      `Trade-in purchases cannot be ${action} here; change the trade-in on its vehicle sale instead`,
    );
  }
}
