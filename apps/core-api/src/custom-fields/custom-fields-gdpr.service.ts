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

    const [customer, vehicles, definitions] = await Promise.all([
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
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        vat_id: customer.vat_id,
        address_street: customer.address_street,
        address_zip: customer.address_zip,
        address_city: customer.address_city,
        address_country: customer.address_country,
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
          title: null,
          title_suffix: null,
          letter_salutation: null,
          contact_email_ok: false,
          custom_fields: {},
        }),
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
