import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import type {
  AuthClaimsUpdatedPayload,
  DashboardEntityUpdatedPayload,
  EmitDashboardEntityUpdatedInput,
  SiteAccessScopeUpdatedPayload,
  SiteContextUpdatedPayload,
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

  /**
   * Ruling 9/11/37: `site:context_updated` on `user_{firebaseUid}`. Every
   * socket for that user leaves the previous site room and joins the new one
   * (or no site room) before the event is delivered.
   */
  emitSiteContextUpdated(firebaseUid: string, siteId: string | null): void {
    const payload: SiteContextUpdatedPayload = {
      siteId,
      timestamp: new Date().toISOString(),
    };
    void this.dashboardGateway.emitSiteContextUpdated(firebaseUid, payload);
  }

  /**
   * Ruling 10/37: `site:access_scope_updated` on `user_{firebaseUid}` whenever
   * a site membership grant/revoke/deactivate (or `TenantMember.is_active =
   * false`) changes the caller's site access, including a site that was not the
   * active site.
   */
  emitSiteAccessScopeUpdated(firebaseUid: string): void {
    const payload: SiteAccessScopeUpdatedPayload = {
      timestamp: new Date().toISOString(),
    };
    this.dashboardGateway.emitSiteAccessScopeUpdated(firebaseUid, payload);
  }
}
