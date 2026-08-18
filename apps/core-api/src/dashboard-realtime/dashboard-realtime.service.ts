import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import type {
  AuthClaimsUpdatedPayload,
  DashboardEntityUpdatedPayload,
  EmitDashboardEntityUpdatedInput,
} from './dashboard-events.types';

@Injectable()
export class DashboardRealtimeService {
  constructor(
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
  ) {}

  emitEntityUpdated(
    tenantId: string,
    input: EmitDashboardEntityUpdatedInput,
  ): void {
    const payload: DashboardEntityUpdatedPayload = {
      ...input,
      timestamp: new Date().toISOString(),
    };
    this.dashboardGateway.emitEntityUpdated(tenantId, payload);
  }

  emitClaimsUpdated(firebaseUid: string): void {
    const payload: AuthClaimsUpdatedPayload = {
      reason: 'membership-updated',
      timestamp: new Date().toISOString(),
    };

    this.dashboardGateway.emitClaimsUpdated(firebaseUid, payload);
  }
}
