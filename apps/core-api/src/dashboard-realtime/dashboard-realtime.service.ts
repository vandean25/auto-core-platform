import { Injectable } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import type {
  DashboardEntityUpdatedPayload,
  EmitDashboardEntityUpdatedInput,
} from './dashboard-events.types';

@Injectable()
export class DashboardRealtimeService {
  constructor(private readonly dashboardGateway: DashboardGateway) {}

  emitEntityUpdated(input: EmitDashboardEntityUpdatedInput): void {
    const payload: DashboardEntityUpdatedPayload = {
      ...input,
      timestamp: new Date().toISOString(),
    };
    this.dashboardGateway.emitEntityUpdated(payload);
  }
}
