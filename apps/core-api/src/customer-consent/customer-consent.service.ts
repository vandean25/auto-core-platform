import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertValidCommunicationEventRequest,
  marketingGrantProofComplete,
} from './customer-consent-event-validation.js';
import {
  anyMarketingPurposeNeedsUnsubscribe,
  buildUnsubscribeIdempotencyKey,
  marketingPurposeNeedsUnsubscribe,
} from './customer-consent-unsubscribe.helpers.js';
import {
  AuditActorType,
  AuditLogAction,
  type Customer,
  type CustomerConsentChannel,
  type CustomerConsentPurpose,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import {
  decryptContactAddress,
  encryptContactAddress,
  fingerprintContactAddress,
  normalizeContactAddress,
} from './customer-consent-address-crypto.js';
import {
  assertCustomerInTenant,
  resolveConsentActorMemberId,
  resolveControllerLegalEntityId,
} from './customer-consent.controller-context.js';
import {
  canContact,
  pickLatestLedgerEvent,
  type LedgerEventSlice,
} from './customer-consent.permissions.js';
import {
  ALL_CONSENT_PURPOSES,
  MARKETING_CONSENT_PURPOSES,
} from './customer-consent.purposes.js';
import { consentProofRetainUntil } from './customer-consent-retention.helpers.js';
import { stampProofChainRetainUntil } from './customer-consent-retention.helpers.js';
import {
  hashUnsubscribeToken,
  mintUnsubscribeToken,
} from './customer-consent-token.helpers.js';
import type { RecordCommunicationEventDto } from './dto/customer-consent.dto.js';

const PREFERENCE_CHANNELS: CustomerConsentChannel[] = ['EMAIL', 'SMS', 'PHONE'];

@Injectable()
export class CustomerConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async getCommunicationPreferences(
    customerId: string,
    controllerLegalEntityId?: string,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    await assertCustomerInTenant(this.prisma, tenantId, customerId);
    const controllerId = await resolveControllerLegalEntityId(
      this.prisma,
      tenantId,
      controllerLegalEntityId,
    );
    await resolveConsentActorMemberId(
      this.prisma,
      this.tenantContext,
      tenantId,
      controllerId,
    );

    const controller = await this.prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, id: controllerId },
      select: { id: true, name: true },
    });

    const state = await this.findCommunicationStateOrDefault(
      tenantId,
      controllerId,
      customerId,
    );
    const customer = await this.prisma.customer.findFirst({
      where: { tenant_id: tenantId, id: customerId },
      select: { contact_email_ok: true },
    });
    const events = await this.loadLedgerSlices(
      tenantId,
      customerId,
      controllerId,
    );

    const preferences = ALL_CONSENT_PURPOSES.flatMap((purpose) =>
      PREFERENCE_CHANNELS.map((channel) => {
        const decision = canContact({
          purpose,
          channel,
          events,
          processingRestricted: state.processing_status !== 'ACTIVE',
          transactionalProjection: {
            orderEmailConfirmed: customer?.contact_email_ok ?? false,
          },
        });
        const latest = events
          .filter(
            (event) => event.channel === channel && event.purpose === purpose,
          )
          .sort((a, b) => b.sequence - a.sequence)[0];
        return {
          channel,
          purpose,
          effective_status: latest?.status ?? null,
          allowed: decision.allowed,
          reason: decision.reason,
        };
      }),
    );

    return {
      customer_id: customerId,
      controller_legal_entity_id: controllerId,
      controller_legal_entity_name: controller?.name ?? null,
      revision: state.revision,
      processing_status: state.processing_status,
      preferences,
    };
  }

  async listCommunicationHistory(
    customerId: string,
    controllerLegalEntityId?: string,
    page = 1,
    pageSize = 25,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    await assertCustomerInTenant(this.prisma, tenantId, customerId);
    const controllerId = await resolveControllerLegalEntityId(
      this.prisma,
      tenantId,
      controllerLegalEntityId,
    );
    await resolveConsentActorMemberId(
      this.prisma,
      this.tenantContext,
      tenantId,
      controllerId,
    );

    const where: Prisma.CustomerConsentWhereInput = {
      tenant_id: tenantId,
      customer_id: customerId,
      controller_legal_entity_id: controllerId,
    };
    const skip = (page - 1) * pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.customerConsent.findMany({
        where,
        orderBy: [{ sequence: 'desc' }, { recorded_at: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.customerConsent.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toEventSummary(row)),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async recordCommunicationEvent(
    customerId: string,
    dto: RecordCommunicationEventDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    await assertCustomerInTenant(this.prisma, tenantId, customerId);
    const controllerId = await resolveControllerLegalEntityId(
      this.prisma,
      tenantId,
      dto.controller_legal_entity_id,
    );
    const actorMemberId = await resolveConsentActorMemberId(
      this.prisma,
      this.tenantContext,
      tenantId,
      controllerId,
    );

    assertValidCommunicationEventRequest(dto);

    const customer = await this.prisma.customer.findFirst({
      where: { tenant_id: tenantId, id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    await this.ensureCommunicationStateRow(tenantId, controllerId, customerId);

    const existing = await this.prisma.customerConsent.findFirst({
      where: {
        tenant_id: tenantId,
        controller_legal_entity_id: controllerId,
        customer_id: customerId,
        idempotency_key: dto.idempotency_key,
      },
    });
    if (existing) {
      const state = await this.prisma.customerCommunicationState.findFirst({
        where: {
          tenant_id: tenantId,
          controller_legal_entity_id: controllerId,
          customer_id: customerId,
        },
      });
      return {
        ...this.toEventSummary(existing),
        revision: state?.revision ?? 0,
      };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const state = await this.lockCommunicationState(
          tx,
          tenantId,
          controllerId,
          customerId,
        );
        if (state.revision !== dto.expected_revision) {
          throw new ConflictException('Stale communication state revision.');
        }

        const contactPoint = await this.resolveContactPoint(
          tx,
          tenantId,
          customer,
          dto.channel,
          dto.contact_address,
        );

        const lastSequence = await tx.customerConsent.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: customerId,
            controller_legal_entity_id: controllerId,
            channel: dto.channel,
            purpose: dto.purpose,
          },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        });
        const sequence = (lastSequence?.sequence ?? 0) + 1;
        const serverNow = new Date();
        const occurredAt = dto.occurred_at
          ? new Date(dto.occurred_at)
          : serverNow;
        const isRevocation = dto.status === 'REVOKED';

        const created = await tx.customerConsent.create({
          data: {
            id: randomUUID(),
            tenant_id: tenantId,
            controller_legal_entity_id: controllerId,
            customer_id: customerId,
            contact_point_id: contactPoint?.id ?? null,
            channel: dto.channel,
            purpose: dto.purpose,
            status: dto.status,
            basis: dto.basis ?? null,
            sequence,
            occurred_at: occurredAt,
            source: dto.source,
            actor_member_id: actorMemberId,
            text_version: dto.text_version ?? null,
            text_language: dto.text_language ?? null,
            text_snapshot: dto.text_snapshot ?? null,
            evidence: (dto.evidence ?? undefined) as
              Prisma.InputJsonValue | undefined,
            revoked_at: isRevocation ? serverNow : null,
            idempotency_key: dto.idempotency_key,
            retain_until: null,
          },
        });

        if (isRevocation) {
          const controller = await tx.legalEntity.findFirst({
            where: { tenant_id: tenantId, id: controllerId },
            select: { country_iso: true },
          });
          await stampProofChainRetainUntil(tx, {
            tenantId,
            controllerLegalEntityId: controllerId,
            customerId,
            channel: dto.channel,
            purposes: [dto.purpose],
            cessationAt: serverNow,
            countryIso: controller?.country_iso,
          });
        }

        const nextRevision = state.revision + 1;
        await tx.customerCommunicationState.update({
          where: { id: state.id },
          data: { revision: nextRevision },
        });

        await this.auditService.recordTenantMutation(
          {
            entityType: 'CustomerConsent',
            entityId: created.id,
            action: AuditLogAction.CREATE,
            after: this.toEventSummary(created),
            source: 'customer-consent.recordCommunicationEvent',
          },
          tx,
        );

        return {
          ...this.toEventSummary(created),
          revision: nextRevision,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.prisma.customerConsent.findFirst({
          where: {
            tenant_id: tenantId,
            controller_legal_entity_id: controllerId,
            customer_id: customerId,
            idempotency_key: dto.idempotency_key,
          },
        });
        if (replay) {
          const state = await this.prisma.customerCommunicationState.findFirst({
            where: {
              tenant_id: tenantId,
              controller_legal_entity_id: controllerId,
              customer_id: customerId,
            },
          });
          return {
            ...this.toEventSummary(replay),
            revision: state?.revision ?? 0,
          };
        }
      }
      throw error;
    }
  }

  async mintMarketingUnsubscribeToken(params: {
    customerId: string;
    controllerLegalEntityId: string;
    channel: CustomerConsentChannel;
    contactFingerprint: string;
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const token = mintUnsubscribeToken();
    const controller = await this.prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, id: params.controllerLegalEntityId },
      select: { country_iso: true },
    });
    const retainUntil = consentProofRetainUntil(
      new Date(),
      controller?.country_iso,
    );
    await this.prisma.customerConsentUnsubscribeToken.create({
      data: {
        id: randomUUID(),
        tenant_id: tenantId,
        controller_legal_entity_id: params.controllerLegalEntityId,
        customer_id: params.customerId,
        channel: params.channel,
        contact_fingerprint: params.contactFingerprint,
        token_sha256: token.sha256,
        retain_until: retainUntil,
      },
    });
    return token.raw;
  }

  async withdrawMarketingByUnsubscribeToken(rawToken: string): Promise<void> {
    const tokenHash = hashUnsubscribeToken(rawToken);
    const tokenRow =
      await this.systemPrisma.customerConsentUnsubscribeToken.findFirst({
        where: { token_sha256: tokenHash },
      });
    if (!tokenRow) {
      return;
    }

    const now = new Date();
    if (tokenRow.retain_until < now) {
      return;
    }

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: 'public-consent-unsubscribe',
        email: 'public-unsubscribe@system.local',
        tenantId: tokenRow.tenant_id,
        role: 'SYSTEM',
      });

      try {
        await this.ensureCommunicationStateRow(
          tokenRow.tenant_id,
          tokenRow.controller_legal_entity_id,
          tokenRow.customer_id,
        );

        await this.prisma.$transaction(async (tx) => {
          const state = await this.lockCommunicationState(
            tx,
            tokenRow.tenant_id,
            tokenRow.controller_legal_entity_id,
            tokenRow.customer_id,
          );

          const ledgerEvents = await tx.customerConsent.findMany({
            where: {
              tenant_id: tokenRow.tenant_id,
              customer_id: tokenRow.customer_id,
              controller_legal_entity_id: tokenRow.controller_legal_entity_id,
            },
            select: {
              purpose: true,
              channel: true,
              status: true,
              sequence: true,
              basis: true,
              text_version: true,
              text_snapshot: true,
              evidence: true,
            },
          });
          const eventSlices: LedgerEventSlice[] = ledgerEvents.map((row) => ({
            purpose: row.purpose,
            channel: row.channel,
            status: row.status,
            sequence: row.sequence,
            basis: row.basis,
            text_version: row.text_version,
            text_snapshot: row.text_snapshot,
            evidence: row.evidence as LedgerEventSlice['evidence'],
          }));

          if (
            !anyMarketingPurposeNeedsUnsubscribe(eventSlices, tokenRow.channel)
          ) {
            return;
          }

          if (!tokenRow.used_at) {
            await tx.customerConsentUnsubscribeToken.updateMany({
              where: { id: tokenRow.id, used_at: null },
              data: { used_at: now },
            });
          }

          let wroteRevoke = false;
          for (const purpose of MARKETING_CONSENT_PURPOSES) {
            const { needed, supersededSequence } =
              marketingPurposeNeedsUnsubscribe(
                eventSlices,
                purpose,
                tokenRow.channel,
              );
            if (!needed) {
              continue;
            }
            const idempotencyKey = buildUnsubscribeIdempotencyKey(
              tokenHash,
              purpose,
              supersededSequence,
            );
            const existing = await tx.customerConsent.findFirst({
              where: {
                tenant_id: tokenRow.tenant_id,
                controller_legal_entity_id: tokenRow.controller_legal_entity_id,
                customer_id: tokenRow.customer_id,
                idempotency_key: idempotencyKey,
              },
            });
            if (existing) {
              continue;
            }

            const lastSequence = await tx.customerConsent.findFirst({
              where: {
                tenant_id: tokenRow.tenant_id,
                customer_id: tokenRow.customer_id,
                controller_legal_entity_id: tokenRow.controller_legal_entity_id,
                channel: tokenRow.channel,
                purpose,
              },
              orderBy: { sequence: 'desc' },
              select: { sequence: true },
            });
            const sequence = (lastSequence?.sequence ?? 0) + 1;
            const created = await tx.customerConsent.create({
              data: {
                id: randomUUID(),
                tenant_id: tokenRow.tenant_id,
                controller_legal_entity_id: tokenRow.controller_legal_entity_id,
                customer_id: tokenRow.customer_id,
                channel: tokenRow.channel,
                purpose,
                status: 'REVOKED',
                sequence,
                occurred_at: now,
                source: 'UNSUBSCRIBE',
                revoked_at: now,
                idempotency_key: idempotencyKey,
                retain_until: null,
                evidence: {
                  contact_fingerprint: tokenRow.contact_fingerprint,
                },
              },
            });
            wroteRevoke = true;

            await this.auditService.recordTenantMutation(
              {
                entityType: 'CustomerConsent',
                entityId: created.id,
                action: AuditLogAction.CREATE,
                actorType: AuditActorType.SYSTEM,
                after: this.toEventSummary(created),
                source: 'customer-consent.publicUnsubscribe',
              },
              tx,
            );
          }

          if (!wroteRevoke) {
            return;
          }

          const controller = await tx.legalEntity.findFirst({
            where: {
              tenant_id: tokenRow.tenant_id,
              id: tokenRow.controller_legal_entity_id,
            },
            select: { country_iso: true },
          });

          await stampProofChainRetainUntil(tx, {
            tenantId: tokenRow.tenant_id,
            controllerLegalEntityId: tokenRow.controller_legal_entity_id,
            customerId: tokenRow.customer_id,
            channel: tokenRow.channel,
            purposes: [...MARKETING_CONSENT_PURPOSES],
            cessationAt: now,
            countryIso: controller?.country_iso,
          });

          await tx.customerCommunicationState.update({
            where: { id: state.id },
            data: { revision: state.revision + 1 },
          });
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return;
        }
        throw error;
      }
    });
  }

  async evaluateCanContactForCustomer(
    customerId: string,
    channel: CustomerConsentChannel,
    purpose: CustomerConsentPurpose,
    controllerLegalEntityId?: string,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const controllerId = await resolveControllerLegalEntityId(
      this.prisma,
      tenantId,
      controllerLegalEntityId,
    );
    const state = await this.findCommunicationStateOrDefault(
      tenantId,
      controllerId,
      customerId,
    );
    const customer = await this.prisma.customer.findFirst({
      where: { tenant_id: tenantId, id: customerId },
      select: { contact_email_ok: true },
    });
    const events = await this.loadLedgerSlices(
      tenantId,
      customerId,
      controllerId,
    );
    return canContact({
      purpose,
      channel,
      events,
      processingRestricted: state.processing_status !== 'ACTIVE',
      transactionalProjection: {
        orderEmailConfirmed: customer?.contact_email_ok ?? false,
      },
    });
  }

  private async loadLedgerSlices(
    tenantId: string,
    customerId: string,
    controllerId: string,
  ): Promise<LedgerEventSlice[]> {
    const rows = await this.prisma.customerConsent.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        controller_legal_entity_id: controllerId,
      },
      select: {
        purpose: true,
        channel: true,
        status: true,
        sequence: true,
        basis: true,
        text_version: true,
        text_snapshot: true,
        evidence: true,
      },
    });
    return rows.map((row) => ({
      purpose: row.purpose,
      channel: row.channel,
      status: row.status,
      sequence: row.sequence,
      basis: row.basis,
      text_version: row.text_version,
      text_snapshot: row.text_snapshot,
      evidence: row.evidence as LedgerEventSlice['evidence'],
    }));
  }

  private async findCommunicationStateOrDefault(
    tenantId: string,
    controllerId: string,
    customerId: string,
  ) {
    const existing = await this.prisma.customerCommunicationState.findFirst({
      where: {
        tenant_id: tenantId,
        controller_legal_entity_id: controllerId,
        customer_id: customerId,
      },
    });
    if (existing) {
      return existing;
    }
    return {
      id: '',
      revision: 0,
      processing_status: 'ACTIVE' as const,
    };
  }

  private async ensureCommunicationStateRow(
    tenantId: string,
    controllerId: string,
    customerId: string,
  ) {
    await this.prisma.customerCommunicationState.upsert({
      where: {
        tenant_id_controller_legal_entity_id_customer_id: {
          tenant_id: tenantId,
          controller_legal_entity_id: controllerId,
          customer_id: customerId,
        },
      },
      create: {
        id: randomUUID(),
        tenant_id: tenantId,
        controller_legal_entity_id: controllerId,
        customer_id: customerId,
      },
      update: {},
    });
  }

  private async lockCommunicationState(
    tx: Prisma.TransactionClient,
    tenantId: string,
    controllerId: string,
    customerId: string,
  ) {
    // eslint-disable-next-line no-restricted-syntax -- tenant-qualified communication state row lock (FOR UPDATE) for consent ledger serialization.
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        revision: number;
        processing_status: Prisma.CustomerCommunicationStateGetPayload<object>['processing_status'];
      }>
    >(
      Prisma.sql`
        SELECT id, revision, processing_status
        FROM customer_communication_states
        WHERE tenant_id = ${tenantId}
          AND controller_legal_entity_id = ${controllerId}
          AND customer_id = ${customerId}
        FOR UPDATE
      `,
    );
    const row = locked[0];
    if (!row) {
      throw new NotFoundException('Communication state not found.');
    }
    return row;
  }

  private async resolveContactPoint(
    tx: Prisma.TransactionClient,
    tenantId: string,
    customer: Customer,
    channel: CustomerConsentChannel,
    explicitAddress?: string,
  ) {
    const raw =
      explicitAddress ??
      (channel === 'EMAIL'
        ? customer.email
        : channel === 'SMS' || channel === 'PHONE'
          ? customer.phone
          : null);
    if (!raw) {
      return null;
    }
    const normalized = normalizeContactAddress(channel, raw);
    const fingerprint = fingerprintContactAddress(
      tenantId,
      channel,
      normalized,
    );
    const encrypted = encryptContactAddress(normalized);
    const existing = await tx.customerContactPoint.findFirst({
      where: {
        tenant_id: tenantId,
        customer_id: customer.id,
        channel,
        address_fingerprint: fingerprint,
      },
    });
    if (existing) {
      if (!existing.is_current) {
        await tx.customerContactPoint.updateMany({
          where: {
            tenant_id: tenantId,
            customer_id: customer.id,
            channel,
            is_current: true,
          },
          data: { is_current: false },
        });
        return tx.customerContactPoint.update({
          where: { id: existing.id },
          data: { is_current: true, encrypted_address: encrypted },
        });
      }
      return existing;
    }

    await tx.customerContactPoint.updateMany({
      where: {
        tenant_id: tenantId,
        customer_id: customer.id,
        channel,
        is_current: true,
      },
      data: { is_current: false },
    });

    return tx.customerContactPoint.create({
      data: {
        id: randomUUID(),
        tenant_id: tenantId,
        customer_id: customer.id,
        channel,
        encrypted_address: encrypted,
        address_fingerprint: fingerprint,
        is_current: true,
      },
    });
  }

  /** Decrypts a stored contact point for authorised staff display (masked in API later). */
  decryptStoredAddress(encrypted: string): string {
    return decryptContactAddress(encrypted);
  }

  private toEventSummary(row: {
    id: string;
    channel: CustomerConsentChannel;
    purpose: CustomerConsentPurpose;
    status: Prisma.CustomerConsentGetPayload<object>['status'];
    basis: Prisma.CustomerConsentGetPayload<object>['basis'];
    sequence: number;
    recorded_at: Date;
    occurred_at: Date;
    source: Prisma.CustomerConsentGetPayload<object>['source'];
    revoked_at: Date | null;
  }) {
    return {
      id: row.id,
      channel: row.channel,
      purpose: row.purpose,
      status: row.status,
      basis: row.basis,
      sequence: row.sequence,
      recorded_at: row.recorded_at.toISOString(),
      occurred_at: row.occurred_at.toISOString(),
      source: row.source,
      revoked_at: row.revoked_at?.toISOString() ?? null,
    };
  }

  /**
   * Batch-checks whether each customer has active PHONE consent for PICKERL_REMINDER or SERVICE_REMINDER
   * across any active controller legal entity of the tenant.
   */
  async loadPhonePickerlConsentByCustomerIds(
    tenantId: string,
    customerIds: string[],
  ): Promise<Map<string, boolean>> {
    const uniqueIds = [...new Set(customerIds)];
    const result = new Map<string, boolean>();
    if (uniqueIds.length === 0) {
      return result;
    }

    const activeControllers = await this.prisma.legalEntity.findMany({
      where: { tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    const controllerIds = activeControllers.map((c) => c.id);
    if (controllerIds.length === 0) {
      for (const customerId of uniqueIds) {
        result.set(customerId, false);
      }
      return result;
    }

    const [states, consents] = await Promise.all([
      this.prisma.customerCommunicationState.findMany({
        where: {
          tenant_id: tenantId,
          controller_legal_entity_id: { in: controllerIds },
          customer_id: { in: uniqueIds },
        },
        select: {
          customer_id: true,
          controller_legal_entity_id: true,
          processing_status: true,
        },
      }),
      this.prisma.customerConsent.findMany({
        where: {
          tenant_id: tenantId,
          controller_legal_entity_id: { in: controllerIds },
          customer_id: { in: uniqueIds },
          channel: 'PHONE',
          purpose: { in: ['PICKERL_REMINDER', 'SERVICE_REMINDER'] },
        },
        select: {
          customer_id: true,
          controller_legal_entity_id: true,
          purpose: true,
          channel: true,
          status: true,
          sequence: true,
          basis: true,
          text_version: true,
          text_snapshot: true,
          evidence: true,
        },
      }),
    ]);

    const restrictedByCustomerController = new Set(
      states
        .filter((state) => state.processing_status !== 'ACTIVE')
        .map(
          (state) => `${state.customer_id}:${state.controller_legal_entity_id}`,
        ),
    );
    const eventsByCustomerController =
      indexEventsByCustomerAndController(consents);

    for (const customerId of uniqueIds) {
      const byController = eventsByCustomerController.get(customerId);
      if (!byController) {
        result.set(customerId, false);
        continue;
      }
      result.set(
        customerId,
        hasActivePhoneConsentOnAnyController(
          customerId,
          byController,
          restrictedByCustomerController,
        ),
      );
    }

    return result;
  }

  /**
   * Immediately revokes PHONE consents for PICKERL_REMINDER and SERVICE_REMINDER
   * on each controller legal entity that has a PHONE ledger for the customer.
   */
  async revokePhonePickerlConsents(params: {
    tenantId: string;
    customerId: string;
    actorMemberId: string | null;
    actorUserId?: string | null;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    const purposes: CustomerConsentPurpose[] = [
      'PICKERL_REMINDER',
      'SERVICE_REMINDER',
    ];
    const ledgerControllers = await params.tx.customerConsent.findMany({
      where: {
        tenant_id: params.tenantId,
        customer_id: params.customerId,
        channel: 'PHONE',
        purpose: { in: purposes },
      },
      distinct: ['controller_legal_entity_id'],
      select: { controller_legal_entity_id: true },
    });

    for (const {
      controller_legal_entity_id: controllerId,
    } of ledgerControllers) {
      await this.revokePhonePickerlConsentsForController({
        ...params,
        controllerId,
        purposes,
      });
    }
  }

  private async revokePhonePickerlConsentsForController(params: {
    tenantId: string;
    customerId: string;
    controllerId: string;
    purposes: CustomerConsentPurpose[];
    actorMemberId: string | null;
    actorUserId?: string | null;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    const { tenantId, customerId, controllerId, purposes } = params;
    await this.ensureCommunicationStateRowInTx(
      params.tx,
      tenantId,
      controllerId,
      customerId,
    );
    const state = await this.lockCommunicationState(
      params.tx,
      tenantId,
      controllerId,
      customerId,
    );
    const controller = await params.tx.legalEntity.findFirst({
      where: { tenant_id: tenantId, id: controllerId },
      select: { country_iso: true },
    });
    const now = new Date();

    for (const purpose of purposes) {
      const last = await params.tx.customerConsent.findFirst({
        where: {
          tenant_id: tenantId,
          customer_id: customerId,
          controller_legal_entity_id: controllerId,
          channel: 'PHONE',
          purpose,
        },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, status: true },
      });
      if (last?.status === 'REVOKED') {
        continue;
      }
      const sequence = (last?.sequence ?? 0) + 1;
      const created = await params.tx.customerConsent.create({
        data: {
          id: randomUUID(),
          tenant_id: tenantId,
          controller_legal_entity_id: controllerId,
          customer_id: customerId,
          channel: 'PHONE',
          purpose,
          status: 'REVOKED',
          sequence,
          occurred_at: now,
          source: 'PROFILE',
          actor_member_id: params.actorMemberId,
          revoked_at: now,
        },
      });
      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomerConsent',
          entityId: created.id,
          action: AuditLogAction.CREATE,
          actorUserId: params.actorUserId ?? null,
          after: this.toEventSummary(created),
          source: 'pickerl-contact-dialog.revoke',
        },
        params.tx,
      );
    }

    await stampProofChainRetainUntil(params.tx, {
      tenantId,
      controllerLegalEntityId: controllerId,
      customerId,
      channel: 'PHONE',
      purposes,
      cessationAt: now,
      countryIso: controller?.country_iso,
    });

    await params.tx.customerCommunicationState.update({
      where: { id: state.id },
      data: { revision: state.revision + 1 },
    });
  }

  private async ensureCommunicationStateRowInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    controllerLegalEntityId: string,
    customerId: string,
  ): Promise<void> {
    await tx.customerCommunicationState.upsert({
      where: {
        tenant_id_controller_legal_entity_id_customer_id: {
          tenant_id: tenantId,
          controller_legal_entity_id: controllerLegalEntityId,
          customer_id: customerId,
        },
      },
      create: {
        id: randomUUID(),
        tenant_id: tenantId,
        controller_legal_entity_id: controllerLegalEntityId,
        customer_id: customerId,
        revision: 0,
        processing_status: 'ACTIVE',
      },
      update: {},
    });
  }
}

function indexEventsByCustomerAndController(
  consents: Array<{
    customer_id: string;
    controller_legal_entity_id: string;
    purpose: LedgerEventSlice['purpose'];
    channel: LedgerEventSlice['channel'];
    status: LedgerEventSlice['status'];
    sequence: number;
    basis: LedgerEventSlice['basis'];
    text_version: string | null;
    text_snapshot: string | null;
    evidence: unknown;
  }>,
): Map<string, Map<string, LedgerEventSlice[]>> {
  const byCustomer = new Map<string, Map<string, LedgerEventSlice[]>>();
  for (const row of consents) {
    let byController = byCustomer.get(row.customer_id);
    if (!byController) {
      byController = new Map<string, LedgerEventSlice[]>();
      byCustomer.set(row.customer_id, byController);
    }
    const list = byController.get(row.controller_legal_entity_id) ?? [];
    list.push({
      purpose: row.purpose,
      channel: row.channel,
      status: row.status,
      sequence: row.sequence,
      basis: row.basis,
      text_version: row.text_version,
      text_snapshot: row.text_snapshot,
      evidence: row.evidence as LedgerEventSlice['evidence'],
    });
    byController.set(row.controller_legal_entity_id, list);
  }
  return byCustomer;
}

function hasActivePhoneConsentOnAnyController(
  customerId: string,
  byController: Map<string, LedgerEventSlice[]>,
  restrictedByCustomerController: Set<string>,
): boolean {
  for (const [controllerId, events] of byController.entries()) {
    if (restrictedByCustomerController.has(`${customerId}:${controllerId}`)) {
      continue;
    }
    const hasGrant = (['PICKERL_REMINDER', 'SERVICE_REMINDER'] as const).some(
      (purpose) => {
        const latest = pickLatestLedgerEvent(events, purpose, 'PHONE');
        return (
          latest !== null &&
          latest.status === 'GRANTED' &&
          marketingGrantProofComplete(latest)
        );
      },
    );
    if (hasGrant) {
      return true;
    }
  }
  return false;
}
