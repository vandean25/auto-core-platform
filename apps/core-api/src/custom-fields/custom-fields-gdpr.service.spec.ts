import { AuditLogAction, CustomFieldEntity, CustomFieldType } from '@prisma/client';
import { CustomFieldsGdprService } from './custom-fields-gdpr.service.js';

describe('CustomFieldsGdprService', () => {
  const tenantId = 'tenant-1';
  const customerId = 'cust-1';

  it('exports custom field values with labels for customer and vehicles even when definitions are archived', async () => {
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: customerId,
          type: 'PRIVATE',
          company_name: null,
          first_name: 'Max',
          last_name: 'Mustermann',
          email: 'max@example.com',
          phone: null,
          vat_id: null,
          address_street: null,
          address_zip: null,
          address_city: null,
          address_country: 'AT',
          custom_fields: { flottennummer: 'FL-99', alt_feld: 'Legacy' },
        }),
      },
      vehicle: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'veh-1',
            make: 'VW',
            model: 'Golf',
            year: 2022,
            vin: null,
            plate: 'W-123AB',
            custom_fields: { stellplatz: 'B4' },
          },
        ]),
      },
      customFieldDefinition: {
        findMany: jest.fn().mockResolvedValue([
          {
            entity: CustomFieldEntity.CUSTOMER,
            key: 'flottennummer',
            label: 'Flottennummer',
            type: CustomFieldType.TEXT,
            purpose: 'Abrechnung',
            personal_data: true,
            retention_class: 'PARENT_OBJECT',
            archived: false,
          },
          {
            entity: CustomFieldEntity.CUSTOMER,
            key: 'alt_feld',
            label: 'Altes Feld',
            type: CustomFieldType.TEXT,
            purpose: 'Historie',
            personal_data: true,
            retention_class: 'PARENT_OBJECT',
            archived: true,
          },
          {
            entity: CustomFieldEntity.VEHICLE,
            key: 'stellplatz',
            label: 'Stellplatz',
            type: CustomFieldType.TEXT,
            purpose: 'Werkstatt',
            personal_data: false,
            retention_class: 'PARENT_OBJECT',
            archived: false,
          },
        ]),
      },
      customerContactPoint: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cp-1', channel: 'EMAIL', is_current: true, transport_validity: 'VALID' },
        ]),
      },
      customerConsent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'consent-1', channel: 'EMAIL', purpose: 'SERVICE', status: 'GRANTED', sequence: 1 },
        ]),
      },
      salesOrder: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'so-1', order_number: 'SO-2026-001', status: 'CONFIRMED' },
        ]),
      },
      workshopOrder: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'wo-1', order_number: 'WO-2026-001', status: 'COMPLETED' },
        ]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'inv-1', invoice_number: 'RE-2026-001', status: 'FINALIZED' },
        ]),
      },
      site: {
        findMany: jest.fn().mockResolvedValue([{ id: 'site-1' }]),
      },
    };

    const service = new CustomFieldsGdprService(
      prisma as never,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN', userId: 'u1' }),
      } as never,
      { recordTenantMutation: jest.fn() } as never,
    );

    const pkg = await service.exportCustomerArt15Package(customerId);
    expect(pkg.customer.custom_fields).toEqual([
      expect.objectContaining({
        key: 'flottennummer',
        label: 'Flottennummer',
        value: 'FL-99',
        archived: false,
      }),
      expect.objectContaining({
        key: 'alt_feld',
        label: 'Altes Feld',
        value: 'Legacy',
        archived: true,
      }),
    ]);
    expect(pkg.vehicles[0].custom_fields).toEqual([
      expect.objectContaining({
        key: 'stellplatz',
        label: 'Stellplatz',
        value: 'B4',
      }),
    ]);
    expect(pkg.contact_points).toHaveLength(1);
    expect(pkg.consent_events).toHaveLength(1);
    expect(pkg.sales_orders).toHaveLength(1);
    expect(pkg.workshop_orders).toHaveLength(1);
    expect(pkg.invoices).toHaveLength(1);
    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
      },
    });
  });

  it('clears custom_fields, free-text fields, and contact-point addresses during erasure', async () => {
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: customerId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerContactPoint: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicle: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };
    const auditService = {
      recordTenantMutation: jest.fn().mockResolvedValue(undefined),
    };

    const service = new CustomFieldsGdprService(
      prisma as never,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER', userId: 'u1' }),
      } as never,
      auditService as never,
    );

    const res = await service.eraseCustomerPersonalData(customerId);
    expect(res).toEqual({ id: customerId, erased: true });
    expect(prisma.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: customerId, tenant_id: tenantId },
        data: expect.objectContaining({
          custom_fields: {},
          salutation: null,
          block_reason: null,
          legacy_restricted_reason: null,
          payment_terms_text: null,
        }),
      }),
    );
    expect(prisma.customerContactPoint.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, customer_id: customerId },
      data: { encrypted_address: 'ERASED', is_current: false },
    });
    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, customer_id: customerId },
      data: { custom_fields: {} },
    });
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Customer',
        entityId: customerId,
        action: AuditLogAction.UPDATE,
        source: 'GDPR_ERASURE',
      }),
      prisma,
    );
  });

  it('throws NotFoundException when customer is not in the active tenant', async () => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      customFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      customerContactPoint: { findMany: jest.fn().mockResolvedValue([]) },
      customerConsent: { findMany: jest.fn().mockResolvedValue([]) },
      salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
      workshopOrder: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      site: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CustomFieldsGdprService(
      prisma as never,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN', userId: 'u1' }),
      } as never,
      { recordTenantMutation: jest.fn() } as never,
    );

    await expect(service.exportCustomerArt15Package(customerId)).rejects.toThrow(
      `Customer with ID ${customerId} not found`,
    );
    await expect(service.eraseCustomerPersonalData(customerId)).rejects.toThrow(
      `Customer with ID ${customerId} not found`,
    );
  });
});
