import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CallerAccess } from './stock-transfer-access.types.js';
import {
  serializeStockTransfer,
  SerializedStockTransfer,
  StockTransferWithSitesAndLines,
} from './stock-transfer-serializer.js';

@Injectable()
export class StockTransferCommitService {
  private readonly logger = new Logger(StockTransferCommitService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    private readonly realtimeService: DashboardRealtimeService,
  ) {}

  async generateTransferNumber(tx: Prisma.TransactionClient) {
    const tenantId = await this.tenantContext.getTenantId();
    const currentYear = new Date().getFullYear();
    const prefix = `TR-${currentYear}-`;

    await tx.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: {},
      create: {
        tenant_id: tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: 'RE-2026-',
        next_sales_order_number: 1001,
        sales_order_prefix: 'SO-2026-',
        next_workshop_order_number: 1,
        workshop_order_prefix: `WO-${currentYear}-`,
        stock_transfer_prefix: prefix,
      },
    });

    const settings = await tx.financeSettings.update({
      where: { tenant_id: tenantId },
      data: {
        next_stock_transfer_number: { increment: 1 },
      },
      select: { next_stock_transfer_number: true, stock_transfer_prefix: true },
    });

    const paddedSequence = String(
      settings.next_stock_transfer_number - 1,
    ).padStart(4, '0');
    return `${settings.stock_transfer_prefix}${paddedSequence}`;
  }

  async resolveRecipients(
    tenantId: string,
    fromSiteId: string,
    toSiteId: string,
  ) {
    const memberships = await this.prisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        is_active: true,
        site_id: { in: [fromSiteId, toSiteId] },
        site: { is_active: true },
        tenantMember: { is_active: true },
      },
      select: { site_id: true, user: { select: { firebaseUid: true } } },
    });

    const byFirebaseUid = new Map<
      string,
      { firebaseUid: string; includeSourceBin: boolean }
    >();
    for (const membership of memberships) {
      const siteId = membership.site_id;
      if (!siteId) {
        continue;
      }
      const firebaseUid = membership.user.firebaseUid;
      if (!firebaseUid) {
        continue;
      }
      const existing = byFirebaseUid.get(firebaseUid);
      const includeSourceBin = siteId === fromSiteId;
      if (existing) {
        existing.includeSourceBin =
          existing.includeSourceBin || includeSourceBin;
      } else {
        byFirebaseUid.set(firebaseUid, { firebaseUid, includeSourceBin });
      }
    }
    return [...byFirebaseUid.values()];
  }

  async commitTransfer(
    access: CallerAccess,
    action: 'CREATED' | 'UPDATED',
    mutation: (
      tx: Prisma.TransactionClient,
    ) => Promise<StockTransferWithSitesAndLines>,
  ): Promise<SerializedStockTransfer> {
    const transfer = await this.prisma.$transaction(mutation);
    try {
      await this.emitTransferUpdated(access.tenantId, action, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to notify stock transfer ${transfer.id} in tenant ${access.tenantId} after commit: ${message}`,
      );
    }
    return serializeStockTransfer(transfer, {
      includeSourceBin: access.accessBySite.has(transfer.from_site_id),
    });
  }

  async emitTransferUpdated(
    tenantId: string,
    action: 'CREATED' | 'UPDATED',
    transfer: StockTransferWithSitesAndLines,
  ): Promise<void> {
    const recipients = await this.resolveRecipients(
      tenantId,
      transfer.from_site_id,
      transfer.to_site_id,
    );
    this.realtimeService.emitStockTransferUpdated(tenantId, {
      action,
      fromSiteId: transfer.from_site_id,
      toSiteId: transfer.to_site_id,
      transfer: serializeStockTransfer(transfer, {
        includeSourceBin: true,
      }) as unknown as Record<string, unknown>,
      recipients,
    });
  }
}
