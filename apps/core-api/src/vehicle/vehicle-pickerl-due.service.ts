import { Injectable } from '@nestjs/common';
import { projectVehicleListOperationalFields } from '../common/projections/vehicle-entity.projection.js';
import type { PickerlDueListQueryDto } from './dto/pickerl-due-list.dto.js';
import { attachPickerlDue } from './pickerl/attach-pickerl-due.js';
import { stripVehicleIdentityResolutionState } from './vehicle-identity.util.js';
import { VehiclePersistenceService } from './vehicle-persistence.service.js';
import {
  VehiclePickerlQueryBuilder,
  type VehiclePickerlQuery,
} from './vehicle-pickerl-query.builder.js';

export interface VehiclePickerlScope {
  tenantId: string;
  authorizedSiteIds: readonly string[];
}

export interface VehiclePickerlOpenOrderScope {
  tenantId: string;
  activeSiteId: string | null;
}

@Injectable()
export class VehiclePickerlDueService {
  constructor(private readonly persistence: VehiclePersistenceService) {}

  async listDue(
    query: VehiclePickerlQuery,
    scope: VehiclePickerlScope,
    today: Date,
  ) {
    const { where, windowEndDate } =
      VehiclePickerlQueryBuilder.buildCustomerWhere(
        scope.tenantId,
        query,
        today,
      );
    const vehicles = await this.persistence.findPickerlCandidates(where);

    const projected = projectVehicleListOperationalFields(
      vehicles.map(stripVehicleIdentityResolutionState),
      scope.authorizedSiteIds,
    );

    return (projected || [])
      .map((vehicle) => attachPickerlDue(vehicle, today))
      .filter((vehicle) =>
        VehiclePickerlQueryBuilder.isWithinWindow(
          vehicle.pickerl_due,
          query,
          windowEndDate,
        ),
      )
      .sort((left, right) =>
        VehiclePickerlQueryBuilder.compareRows(left, right),
      );
  }

  async findDuePage<TRow extends { id: string }>(
    allData: TRow[],
    query: PickerlDueListQueryDto,
    scope: VehiclePickerlOpenOrderScope,
  ) {
    const { page, pageSize, skip } =
      VehiclePickerlQueryBuilder.resolvePage(query);
    const pageRows = allData.slice(skip, skip + pageSize);
    const vehicleIds = pageRows.map((vehicle) => vehicle.id);

    const openOrders =
      vehicleIds.length === 0 || !scope.activeSiteId
        ? []
        : await this.persistence.findOpenPickerlOrders(
            scope.tenantId,
            scope.activeSiteId,
            vehicleIds,
          );
    const openOrderByVehicle = indexOpenOrdersByVehicle(openOrders);

    const data = pageRows.map((vehicle) => {
      const openOrder = openOrderByVehicle.get(vehicle.id);
      return {
        ...vehicle,
        open_pickerl_order: openOrder
          ? { id: openOrder.id, order_number: openOrder.order_number }
          : null,
      };
    });

    return {
      data,
      meta: {
        total: allData.length,
        page,
        pageSize,
        pageCount: Math.ceil(allData.length / pageSize),
      },
    };
  }
}

/** Keeps the most recent open order per vehicle (orders arrive newest first). */
function indexOpenOrdersByVehicle<TOrder extends { vehicle_id: string }>(
  orders: TOrder[],
): Map<string, TOrder> {
  const byVehicle = new Map<string, TOrder>();
  for (const order of orders) {
    if (!byVehicle.has(order.vehicle_id)) {
      byVehicle.set(order.vehicle_id, order);
    }
  }
  return byVehicle;
}
