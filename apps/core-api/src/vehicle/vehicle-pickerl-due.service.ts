import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogAction, PickerlContactChannel } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { projectVehicleListOperationalFields } from '../common/projections/vehicle-entity.projection.js';
import { CustomerConsentService } from '../customer-consent/customer-consent.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  PickerlContactLogResponseDto,
  RecordPickerlContactDto,
} from './dto/pickerl-contact.dto.js';
import type { PickerlDueListQueryDto } from './dto/pickerl-due-list.dto.js';
import { attachPickerlDue } from './pickerl/attach-pickerl-due.js';
import { stripVehicleIdentityResolutionState } from './vehicle-identity.util.js';
import { VehiclePersistenceService } from './vehicle-persistence.service.js';
import { VehiclePickerlBarrierService } from './vehicle-pickerl-barrier.service.js';
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

export interface VehiclePickerlContactScope {
  tenantId: string;
  userId?: string | null;
}

@Injectable()
export class VehiclePickerlDueService {
  constructor(
    private readonly persistence: VehiclePersistenceService,
    private readonly pickerlBarriers: VehiclePickerlBarrierService,
    private readonly prisma: PrismaService,
    private readonly customerConsent: CustomerConsentService,
    private readonly auditService: AuditService,
  ) {}

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

    const barrierMap = await this.pickerlBarriers.loadBarrierFlagsByVehicleIds(
      scope.tenantId,
      (projected || []).map((vehicle) => vehicle.id),
    );

    const withinWindow = (projected || [])
      .map((vehicle) =>
        attachPickerlDue(
          {
            ...vehicle,
            pickerl_barriers: barrierMap.get(vehicle.id),
          },
          today,
        ),
      )
      .filter((vehicle) =>
        VehiclePickerlQueryBuilder.isWithinWindow(
          vehicle.pickerl_due,
          query,
          windowEndDate,
        ),
      );

    const vehicleIds = withinWindow.map((vehicle) => vehicle.id);
    const customerIds = withinWindow
      .map((vehicle) => vehicle.customer_id)
      .filter((id): id is string => Boolean(id));

    const [contactLogs, phoneConsentMap] = await Promise.all([
      this.persistence.findPickerlContactLogs(scope.tenantId, vehicleIds),
      this.customerConsent.loadPhonePickerlConsentByCustomerIds(
        scope.tenantId,
        customerIds,
      ),
    ]);

    return withinWindow
      .map((vehicle) => {
        const dueMonth = vehicle.pickerl_due.due_month ?? null;
        const latestContact = contactLogs.find(
          (log) =>
            log.vehicle_id === vehicle.id &&
            (log.due_month ?? null) === dueMonth,
        );
        return {
          ...vehicle,
          last_contacted_at: latestContact
            ? latestContact.contacted_at.toISOString()
            : null,
          last_contact_channel: latestContact?.channel ?? null,
          last_contact_by: formatActorName(latestContact?.actor_member?.user),
          last_contact_outcome: latestContact?.outcome ?? null,
          phone_consent_allowed: vehicle.customer_id
            ? (phoneConsentMap.get(vehicle.customer_id) ?? false)
            : false,
        };
      })
      .filter((vehicle) =>
        VehiclePickerlQueryBuilder.matchesContactedFilter(
          vehicle.last_contacted_at,
          query,
          today,
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

  async recordContact(
    vehicleId: string,
    dto: RecordPickerlContactDto,
    scope: VehiclePickerlContactScope,
  ): Promise<PickerlContactLogResponseDto> {
    const vehicle = await this.findVehicleForContact(vehicleId, scope.tenantId);
    const now = new Date();
    const channel = dto.channel ?? PickerlContactChannel.PHONE;
    const contactedAt = dto.contacted_at ? new Date(dto.contacted_at) : now;
    const dueMonth =
      dto.due_month !== undefined
        ? dto.due_month
        : (attachPickerlDue(vehicle, now).pickerl_due.due_month ?? null);

    const [actorMember, hasPhoneConsent] = await Promise.all([
      this.resolveActorMember(scope.tenantId, scope.userId),
      this.resolveHasPhoneConsent(scope.tenantId, vehicle.customer_id),
    ]);

    if (
      channel === PickerlContactChannel.PHONE &&
      !hasPhoneConsent &&
      !dto.no_consent_reason
    ) {
      throw new BadRequestException({
        code: 'PICKERL_NO_CONSENT_REASON_REQUIRED',
        message:
          'A reason is required when logging a phone contact without active phone consent.',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.pickerlContactLog.create({
        data: {
          id: randomUUID(),
          tenant_id: scope.tenantId,
          vehicle_id: vehicleId,
          customer_id: vehicle.customer_id,
          due_month: dueMonth,
          contacted_at: contactedAt,
          channel,
          outcome: dto.outcome ?? null,
          no_consent_reason: dto.no_consent_reason ?? null,
          actor_member_id: actorMember?.id ?? null,
        },
      });

      if (dto.revoke_phone_consent && vehicle.customer_id) {
        await this.customerConsent.revokePhonePickerlConsents({
          tenantId: scope.tenantId,
          customerId: vehicle.customer_id,
          actorMemberId: actorMember?.id ?? null,
          tx,
        });
      }

      await this.auditService.recordTenantMutation(
        {
          entityType: 'PickerlContactLog',
          entityId: row.id,
          action: AuditLogAction.CREATE,
          actorUserId: actorMember?.user?.id ?? null,
          source: resolveContactAuditSource(dto.no_consent_reason),
          after: buildContactAuditAfter({
            vehicleId,
            customerId: vehicle.customer_id,
            dueMonth,
            contactedAt,
            channel,
            dto,
            actorMemberId: actorMember?.id ?? null,
          }),
        },
        tx,
      );

      return row;
    });

    return {
      id: created.id,
      vehicle_id: created.vehicle_id,
      customer_id: created.customer_id,
      due_month: created.due_month,
      contacted_at: created.contacted_at.toISOString(),
      channel: created.channel,
      outcome: created.outcome,
      no_consent_reason: created.no_consent_reason,
      actor_member_id: created.actor_member_id,
      actor_name: formatActorName(actorMember?.user),
      phone_consent_allowed: dto.revoke_phone_consent ? false : hasPhoneConsent,
    };
  }

  private async findVehicleForContact(vehicleId: string, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      include: {
        inspection_records: {
          orderBy: { inspected_on: 'desc' },
          select: {
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
            source: true,
            external_inspection_result_id: true,
          },
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found.');
    }
    return vehicle;
  }

  private async resolveActorMember(tenantId: string, userId?: string | null) {
    if (!userId) {
      return null;
    }
    return this.prisma.tenantMember.findFirst({
      where: {
        tenant_id: tenantId,
        user: { firebaseUid: userId },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  private async resolveHasPhoneConsent(
    tenantId: string,
    customerId: string | null,
  ): Promise<boolean> {
    if (!customerId) {
      return false;
    }
    const consentMap =
      await this.customerConsent.loadPhonePickerlConsentByCustomerIds(
        tenantId,
        [customerId],
      );
    return consentMap.get(customerId) ?? false;
  }
}

function resolveContactAuditSource(
  reason?: RecordPickerlContactDto['no_consent_reason'],
): string {
  return reason === 'MARKETING_CALL_WITHOUT_CONSENT'
    ? 'PICKERL_MARKETING_CALL_WITHOUT_CONSENT'
    : 'PICKERL_CONTACT_LOG';
}

function buildContactAuditAfter(params: {
  vehicleId: string;
  customerId: string | null;
  dueMonth: string | null;
  contactedAt: Date;
  channel: PickerlContactChannel;
  dto: RecordPickerlContactDto;
  actorMemberId: string | null;
}) {
  return {
    vehicle_id: params.vehicleId,
    customer_id: params.customerId,
    due_month: params.dueMonth,
    contacted_at: params.contactedAt.toISOString(),
    channel: params.channel,
    outcome: params.dto.outcome ?? null,
    no_consent_reason: params.dto.no_consent_reason ?? null,
    actor_member_id: params.actorMemberId,
    revoke_phone_consent: Boolean(params.dto.revoke_phone_consent),
  };
}

function formatActorName(
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null,
): string | null {
  if (!user) {
    return null;
  }
  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || user.email || null;
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
