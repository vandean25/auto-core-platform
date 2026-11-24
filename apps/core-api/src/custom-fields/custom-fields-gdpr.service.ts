import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogAction, CustomFieldEntity } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { withPhoneDigits } from '../customer/customer-phone.util.js';
import { asPlainRecord } from './custom-fields.validation.js';

export interface Art15CustomFieldEntry {
  key: string;
  label: string;
  type: string;
  purpose: string;
  personal_data: boolean;
  retention_class: string;
  archived: boolean;
  value: unknown;
}

@Injectable()
export class CustomFieldsGdprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  private mapCustomFieldEntries(
    rawValues: unknown,
    defsByKey: Map<
      string,
      {
        key: string;
        label: string;
        type: string;
        purpose: string;
        personal_data: boolean;
        retention_class: string;
        archived: boolean;
      }
    >,
  ): Art15CustomFieldEntry[] {
    const record = asPlainRecord(rawValues);
    const entries: Art15CustomFieldEntry[] = [];
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined || value === null) continue;
      const def = defsByKey.get(key);
      entries.push({
        key,
        label: def?.label ?? key,
        type: def?.type ?? 'TEXT',
        purpose: def?.purpose ?? '',
        personal_data: def?.personal_data ?? true,
        retention_class: def?.retention_class ?? 'PARENT_OBJECT',
        archived: def?.archived ?? false,
        value,
      });
    }
    return entries;
  }

  /**
   * Generates a GDPR Art. 15 access / export package for a customer, including all
   * stored custom field values (with labels) for the customer and their vehicles,
   * regardless of whether the custom_fields feature flag is currently ON or OFF
   * and regardless of whether definitions have been archived.
   */
  async exportCustomerArt15Package(customerId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const tenantSites = await this.prisma.site.findMany({
      where: { tenant_id: tenantId },
      select: { id: true },
    });
    const tenantSiteIds = tenantSites.map((s) => s.id);

    const [
      customer,
      vehicles,
      definitions,
      contactPoints,
      consentEvents,
      salesOrders,
      workshopOrders,
      invoices,
    ] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
      }),
      this.prisma.vehicle.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: customerId,
        },
      }),
      this.prisma.customFieldDefinition.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ sort_order: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.customerContactPoint.findMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        select: {
          id: true,
          channel: true,
          is_current: true,
          transport_validity: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.customerConsent.findMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        select: {
          id: true,
          channel: true,
          purpose: true,
          status: true,
          basis: true,
          sequence: true,
          occurred_at: true,
          recorded_at: true,
          source: true,
          text_version: true,
          text_language: true,
          revoked_at: true,
        },
        orderBy: [{ occurred_at: 'asc' }, { sequence: 'asc' }],
      }),
      this.prisma.salesOrder.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: customerId,
          OR: [{ site_id: { in: tenantSiteIds } }, { site_id: null }],
        },
        select: {
          id: true,
          order_number: true,
          status: true,
          total_amount: true,
          notes: true,
          vehicle_id: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: customerId,
          OR: [{ site_id: { in: tenantSiteIds } }, { site_id: null }],
        },
        select: {
          id: true,
          order_number: true,
          status: true,
          purpose: true,
          vehicle_id: true,
          odometer: true,
          reported_issue: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.invoice.findMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        select: {
          id: true,
          invoice_number: true,
          draft_number: true,
          status: true,
          date: true,
          due_date: true,
          currency: true,
          total_net: true,
          total_tax: true,
          total_gross: true,
          notes: true,
          vehicle_id: true,
          sales_order_id: true,
          workshop_order_id: true,
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const customerDefs = new Map(
      definitions
        .filter((d) => d.entity === CustomFieldEntity.CUSTOMER)
        .map((d) => [d.key, d]),
    );
    const vehicleDefs = new Map(
      definitions
        .filter((d) => d.entity === CustomFieldEntity.VEHICLE)
        .map((d) => [d.key, d]),
    );

    return {
      generatedAt: new Date().toISOString(),
      customer: {
        id: customer.id,
        type: customer.type,
        company_name: customer.company_name,
        salutation: customer.salutation,
        title: customer.title,
        title_suffix: customer.title_suffix,
        letter_salutation: customer.letter_salutation,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        vat_id: customer.vat_id,
        address_street: customer.address_street,
        address_zip: customer.address_zip,
        address_city: customer.address_city,
        address_country: customer.address_country,
        preferred_language: customer.preferred_language,
        contact_email_ok: customer.contact_email_ok,
        block_level: customer.block_level,
        block_reason: customer.block_reason,
        legacy_restricted_at: customer.legacy_restricted_at,
        legacy_restricted_reason: customer.legacy_restricted_reason,
        payment_terms_days: customer.payment_terms_days,
        payment_terms_text: customer.payment_terms_text,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        custom_fields: this.mapCustomFieldEntries(
          customer.custom_fields,
          customerDefs,
        ),
      },
      vehicles: vehicles.map((v) => ({
        id: v.id,
        make: v.make,
        model: v.model,
        year: v.year,
        vin: v.vin,
        plate: v.plate,
        custom_fields: this.mapCustomFieldEntries(v.custom_fields, vehicleDefs),
      })),
      contact_points: contactPoints,
      consent_events: consentEvents,
      sales_orders: salesOrders,
      workshop_orders: workshopOrders,
      invoices,
    };
  }

  /**
   * Executes GDPR Art. 17 erasure/anonymisation for a customer and their owned
   * vehicles, clearing all custom_fields values so no shadow data survives deletion.
   * Works even when the custom_fields feature flag is OFF.
   */
  async eraseCustomerPersonalData(customerId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const existing = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.updateMany({
        where: { id: customerId, tenant_id: tenantId },
        data: withPhoneDigits({
          company_name: null,
          first_name: 'Anonymisiert',
          last_name: 'Kunde',
          email: null,
          phone: null,
          vat_id: null,
          address_street: null,
          address_zip: null,
          address_city: null,
          salutation: null,
          title: null,
          title_suffix: null,
          letter_salutation: null,
          block_reason: null,
          legacy_restricted_reason: null,
          payment_terms_text: null,
          contact_email_ok: false,
          custom_fields: {},
        }),
      });

      await tx.customerContactPoint.updateMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        data: {
          encrypted_address: 'ERASED',
          is_current: false,
        },
      });

      await tx.vehicle.updateMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        data: { custom_fields: {} },
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'Customer',
          entityId: customerId,
          action: AuditLogAction.UPDATE,
          actorUserId,
          source: 'GDPR_ERASURE',
          after: { erased: true, custom_fields_cleared: true },
        },
        tx,
      );
    });

    return { id: customerId, erased: true };
  }
}
