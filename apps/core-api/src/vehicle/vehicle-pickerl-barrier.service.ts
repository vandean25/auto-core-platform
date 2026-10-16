import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PickerlBarrierFlags } from './pickerl/apply-pickerl-record-selection.js';

const EMPTY_BARRIERS: PickerlBarrierFlags = {};

@Injectable()
export class VehiclePickerlBarrierService {
  constructor(private readonly prisma: PrismaService) {}

  async loadBarrierFlags(
    tenantId: string,
    vehicleId: string,
  ): Promise<PickerlBarrierFlags> {
    const map = await this.loadBarrierFlagsByVehicleIds(tenantId, [vehicleId]);
    return map.get(vehicleId) ?? EMPTY_BARRIERS;
  }

  async loadBarrierFlagsByVehicleIds(
    tenantId: string,
    vehicleIds: readonly string[],
  ): Promise<Map<string, PickerlBarrierFlags>> {
    const uniqueIds = [...new Set(vehicleIds)].filter(Boolean);
    const result = new Map<string, PickerlBarrierFlags>();
    if (uniqueIds.length === 0) {
      return result;
    }

    const [conflictRows, negativeRows, positiveRows] = await Promise.all([
      this.prisma.inspectionExchangeImport.findMany({
        where: {
          tenant_id: tenantId,
          vehicle_id: { in: uniqueIds },
          state: 'CONFLICT',
        },
        select: { vehicle_id: true },
        distinct: ['vehicle_id'],
      }),
      this.prisma.externalInspectionResult.findMany({
        where: {
          tenant_id: tenantId,
          vehicle_id: { in: uniqueIds },
          outcome: 'NEGATIVE',
          acknowledgement_state: 'CONFIRMED',
          finality: 'FINAL',
        },
        orderBy: { inspected_at: 'desc' },
        select: {
          vehicle_id: true,
          inspected_at: true,
          occurrence_kind: true,
        },
      }),
      this.prisma.externalInspectionResult.findMany({
        where: {
          tenant_id: tenantId,
          vehicle_id: { in: uniqueIds },
          outcome: 'POSITIVE',
          acknowledgement_state: 'CONFIRMED',
          finality: 'FINAL',
          occurrence_kind: 'INITIAL',
          plate_valid_until_year: { not: null },
          plate_valid_until_month: { not: null },
          report_identity_id: { not: null },
        },
        orderBy: { inspected_at: 'desc' },
        select: { vehicle_id: true, inspected_at: true },
      }),
    ]);

    const conflictVehicles = new Set(conflictRows.map((row) => row.vehicle_id));
    const latestNegative = pickLatestPerVehicle(negativeRows);
    const latestPositive = pickLatestPerVehicle(positiveRows);

    for (const vehicleId of uniqueIds) {
      const externalConflictBarrier = conflictVehicles.has(vehicleId);
      let negativeBarrier = false;
      const latestNegativeRow = latestNegative.get(vehicleId);
      if (latestNegativeRow) {
        const latestPositiveRow = latestPositive.get(vehicleId);
        const cleared =
          latestPositiveRow &&
          latestPositiveRow.inspected_at.getTime() >
            latestNegativeRow.inspected_at.getTime();
        negativeBarrier = !cleared;
      }
      if (externalConflictBarrier || negativeBarrier) {
        result.set(vehicleId, { externalConflictBarrier, negativeBarrier });
      } else {
        result.set(vehicleId, EMPTY_BARRIERS);
      }
    }

    return result;
  }
}

function pickLatestPerVehicle<
  T extends { vehicle_id: string; inspected_at: Date },
>(rows: T[]): Map<string, T> {
  const byVehicle = new Map<string, T>();
  for (const row of rows) {
    if (!byVehicle.has(row.vehicle_id)) {
      byVehicle.set(row.vehicle_id, row);
    }
  }
  return byVehicle;
}
