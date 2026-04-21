import { Injectable } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import type {
  DashboardEntityUpdatedPayload,
  EmitDashboardEntityUpdatedInput,
} from './dashboard-events.types';

@Injectable()
export class DashboardRealtimeService {
  constructor(private readonly dashboardGateway: DashboardGateway) {}

  emitEntityUpdated(tenantId: string, input: EmitDashboardEntityUpdatedInput): void {
    const payload: DashboardEntityUpdatedPayload = {
      ...input,
      tenantId,
      timestamp: new Date().toISOString(),
    };
    this.dashboardGateway.emitEntityUpdated(payload);
  }
}
