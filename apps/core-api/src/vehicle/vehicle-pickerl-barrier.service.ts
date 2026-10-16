import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PickerlBarrierFlags } from './pickerl/apply-pickerl-record-selection.js';

@Injectable()
export class VehiclePickerlBarrierService {
  constructor(private readonly prisma: PrismaService) {}

  async loadBarrierFlags(
    tenantId: string,
    vehicleId: string,
  ): Promise<PickerlBarrierFlags> {
    const [conflictImport, latestNegative, latestPositive] = await Promise.all([
      this.prisma.inspectionExchangeImport.findFirst({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          state: 'CONFLICT',
        },
        select: { id: true },
      }),
      this.prisma.externalInspectionResult.findFirst({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          outcome: 'NEGATIVE',
          acknowledgement_state: 'CONFIRMED',
          finality: 'FINAL',
        },
        orderBy: { inspected_at: 'desc' },
        select: { inspected_at: true, occurrence_kind: true },
      }),
      this.prisma.externalInspectionResult.findFirst({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          outcome: 'POSITIVE',
          acknowledgement_state: 'CONFIRMED',
          finality: 'FINAL',
          occurrence_kind: 'INITIAL',
        },
        orderBy: { inspected_at: 'desc' },
        select: { inspected_at: true },
      }),
    ]);

    const externalConflictBarrier = Boolean(conflictImport);
    let negativeBarrier = false;
    if (latestNegative) {
      const cleared =
        latestPositive &&
        latestPositive.inspected_at.getTime() >
          latestNegative.inspected_at.getTime();
      negativeBarrier = !cleared;
    }

    return { externalConflictBarrier, negativeBarrier };
  }
}
