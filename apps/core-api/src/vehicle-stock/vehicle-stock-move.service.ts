import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  Prisma,
  VehicleInventoryRole,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import type { MoveVehicleSiteDto } from './dto/move-vehicle-site.dto.js';

const DEALER_ROLES: readonly VehicleInventoryRole[] = [
  VehicleInventoryRole.USED,
  VehicleInventoryRole.NEW,
  VehicleInventoryRole.DEMO,
] as const;

const PARKED_STOCK_STATUSES: readonly VehicleStockStatus[] = [
  VehicleStockStatus.IN_STOCK,
  VehicleStockStatus.RESERVED,
  VehicleStockStatus.IN_PREP,
] as const;

type LockedVehicle = {
  id: string;
  location_id: string | null;
  site_id: string | null;
  inventory_role: VehicleInventoryRole;
  stock_status: VehicleStockStatus | null;
};

@Injectable()
export class VehicleStockMoveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async moveAcrossSites(vehicleId: string, dto: MoveVehicleSiteDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const sourceSiteId = await this.resolveVehicleSite(tenantId, vehicleId);
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();

    this.assertAuthorizedSite(authorizedSiteIds, sourceSiteId);
    this.assertAuthorizedSite(authorizedSiteIds, dto.toSiteId);
    if (sourceSiteId === dto.toSiteId) {
      throw new UnprocessableEntityException(
        'Use the same-site vehicle lot update for moves within one site',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockSitesAndValidateLegalEntity(
        tx,
        tenantId,
        sourceSiteId,
        dto.toSiteId,
      );

      const vehicle = await this.lockVehicle(tx, tenantId, vehicleId);
      this.assertMovableVehicle(vehicle, sourceSiteId, dto.expectedLocationId);

      const destination = await tx.storageLocation.findFirst({
        where: {
          id: dto.toLocationId,
          tenant_id: tenantId,
          site_id: dto.toSiteId,
          type: LocationType.vehicle_lot,
          is_system: false,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!destination) {
        throw new UnprocessableEntityException(
          'Destination must be an active vehicle lot on the target site',
        );
      }

      const updated = await tx.vehicle.updateMany({
        where: {
          id: vehicleId,
          tenant_id: tenantId,
          location_id: dto.expectedLocationId,
          site_id: sourceSiteId,
          inventory_role: { in: [...DEALER_ROLES] },
          stock_status: { in: [...PARKED_STOCK_STATUSES] },
        },
        data: {
          site_id: dto.toSiteId,
          location_id: destination.id,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException(
          'Vehicle location or status changed concurrently. Please refresh.',
        );
      }

      return tx.vehicle.findFirst({
        where: { id: vehicleId, tenant_id: tenantId },
        include: { location: true },
      });
    });
  }

  private async resolveVehicleSite(
    tenantId: string,
    vehicleId: string,
  ): Promise<string> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      include: { location: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    if (!vehicle.location || !vehicle.site_id) {
      throw new UnprocessableEntityException(
        'Parked dealer vehicle must have a site-owned vehicle lot',
      );
    }
    return vehicle.location.site_id;
  }

  private assertAuthorizedSite(authorizedSiteIds: string[], siteId: string) {
    if (!authorizedSiteIds.includes(siteId)) {
      throw new UnprocessableEntityException(
        'Active site membership is required on both vehicle move sites',
      );
    }
  }

  private async lockSitesAndValidateLegalEntity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceSiteId: string,
    targetSiteId: string,
  ) {
    await lockSitesAndAssertActive(tx, tenantId, [sourceSiteId, targetSiteId]);
    const sites = await tx.site.findMany({
      where: { tenant_id: tenantId, id: { in: [sourceSiteId, targetSiteId] } },
      select: { id: true, legal_entity_id: true },
    });
    if (
      sites.length !== 2 ||
      sites[0].legal_entity_id !== sites[1].legal_entity_id
    ) {
      throw new UnprocessableEntityException(
        'Vehicle moves are allowed only between sites of the same legal entity',
      );
    }
  }

  private async lockVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
  ): Promise<LockedVehicle> {
    // eslint-disable-next-line no-restricted-syntax -- row lock is required for vehicle move OCC
    const vehicles = await tx.$queryRaw<LockedVehicle[]>`
      SELECT v.id, v.location_id, v.site_id, v.inventory_role, v.stock_status
      FROM vehicles v
      WHERE v.tenant_id = ${tenantId} AND v.id = ${vehicleId}
      FOR UPDATE
    `;
    if (vehicles.length === 0) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return vehicles[0];
  }

  private assertMovableVehicle(
    vehicle: LockedVehicle,
    sourceSiteId: string,
    expectedLocationId: string,
  ) {
    if (!DEALER_ROLES.includes(vehicle.inventory_role)) {
      throw new UnprocessableEntityException(
        'Only dealer stock vehicles can be moved between sites',
      );
    }
    if (
      !vehicle.stock_status ||
      !PARKED_STOCK_STATUSES.includes(vehicle.stock_status)
    ) {
      throw new ConflictException('SOLD vehicles cannot be moved');
    }
    if (
      vehicle.site_id !== sourceSiteId ||
      vehicle.location_id !== expectedLocationId
    ) {
      throw new ConflictException(
        'Vehicle location changed concurrently. Please refresh.',
      );
    }
  }
}
