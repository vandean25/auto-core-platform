import {
  applyVehicleCreateProposal,
  applyVehicleUpdateProposal,
  enrichVehicleCreateProposal,
  enrichVehicleUpdateProposal,
} from '../vehicle/vehicle-propose.js';
import type { VehicleCreateProposalPayload } from '../vehicle/vehicle-propose.payload.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type {
  PendingActionExecutor,
  PendingActionType,
} from './pending-action-executor.types.js';
import { asRecord } from './pending-action-executor.util.js';

export type VehicleExecutorDeps = {
  prisma: PrismaService;
  tenantContext: Pick<TenantContextService, 'getTenantId'>;
};

function vehicleIdOf(result: unknown): string {
  const record = asRecord(result);
  const vehicleId = record.vehicle_id ?? record.id;
  return typeof vehicleId === 'string' ? vehicleId : '';
}

export function vehicleCreateExecutor(
  deps: VehicleExecutorDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: () => Promise.resolve({}),
    enrichInput: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      return enrichVehicleCreateProposal(
        { prisma: deps.prisma, tenantId },
        input,
      );
    },
    execute: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      const record = asRecord(input);
      const proposal =
        record.action === 'vehicle.create'
          ? (input as VehicleCreateProposalPayload)
          : await enrichVehicleCreateProposal(
              { prisma: deps.prisma, tenantId },
              input,
            );
      return applyVehicleCreateProposal(
        { prisma: deps.prisma, tenantId },
        proposal,
      );
    },
    buildResultSummary: (result) => ({
      vehicle_id: vehicleIdOf(result),
    }),
    buildLogMetadata: (result) => ({
      entityType: 'Vehicle',
      entityId: vehicleIdOf(result),
      reversible: false,
    }),
  };
}

export function vehicleUpdateExecutor(
  deps: VehicleExecutorDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: () => Promise.resolve({}),
    enrichInput: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      return enrichVehicleUpdateProposal(
        { prisma: deps.prisma, tenantId },
        input,
      );
    },
    execute: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      const record = asRecord(input);
      const proposal =
        record.action === 'vehicle.update'
          ? input
          : await enrichVehicleUpdateProposal(
              { prisma: deps.prisma, tenantId },
              input,
            );
      return applyVehicleUpdateProposal(
        { prisma: deps.prisma, tenantId },
        proposal,
      );
    },
    buildResultSummary: (result) => ({
      vehicle_id: vehicleIdOf(result),
    }),
    buildLogMetadata: (result) => ({
      entityType: 'Vehicle',
      entityId: vehicleIdOf(result),
      reversible: true,
    }),
  };
}
