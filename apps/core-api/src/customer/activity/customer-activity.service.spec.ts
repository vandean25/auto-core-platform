import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerActivityService } from './customer-activity.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { TenantContextService } from '../../common/services/tenant-context.service.js';
import type { SiteContextService } from '../../site/site-context.service.js';

function createMockPrisma() {
  return {
    customer: { findFirst: jest.fn() },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
    vehicleParty: { findMany: jest.fn().mockResolvedValue([]) },
    workshopOrder: { findMany: jest.fn().mockResolvedValue([]) },
    salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    creditNote: { findMany: jest.fn().mockResolvedValue([]) },
    notificationOutbox: { findMany: jest.fn().mockResolvedValue([]) },
    customerConsent: { findMany: jest.fn().mockResolvedValue([]) },
    vehicleNotice: { findMany: jest.fn().mockResolvedValue([]) },
    loanerBooking: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function createService(
  prisma: ReturnType<typeof createMockPrisma>,
  role: string | null = 'SALES',
) {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      userId: 'user-1',
      email: 'advisor@example.com',
      tenantId: 'tenant-1',
      role,
    }),
  } as unknown as TenantContextService;

  const siteContext = {
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  } as unknown as SiteContextService;

  return new CustomerActivityService(
    prisma as unknown as PrismaService,
    tenantContext,
    siteContext,
  );
}

describe('CustomerActivityService', () => {
  it('throws NotFoundException when customer does not belong to tenant', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.getActivity('cust-missing', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException on unknown activity type filter', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      email: 'max@example.com',
    });
    const service = createService(prisma);

    await expect(
      service.getActivity('cust-1', { types: 'invoice,unknown_source' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('merges items from all permitted sources newest first and excludes outbox body', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      email: 'max@example.com',
    });
    prisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-1',
        order_number: 'WO-2026-001',
        status: 'INVOICED',
        purpose: 'CUSTOMER_REPAIR',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        vehicle: { make: 'VW', model: 'Golf', plate: 'W-123AB' },
      },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        invoice_number: 'RE-2026-001',
        draft_number: 'RE-D-1',
        status: 'FINALIZED',
        total_gross: '240.00',
        currency: 'EUR',
        date: new Date('2026-11-02T10:00:00.000Z'),
      },
    ]);
    prisma.notificationOutbox.findMany.mockResolvedValue([
      {
        id: 'mail-1',
        subject: 'Ihr Fahrzeug ist abholbereit',
        template_id: 'workshop_order_ready',
        status: 'ACCEPTED',
        channel: 'EMAIL',
        accepted_at: new Date('2026-11-03T12:00:00.000Z'),
        createdAt: new Date('2026-11-03T11:59:00.000Z'),
        workshop_order_id: 'wo-1',
      },
    ]);
    prisma.customerConsent.findMany.mockResolvedValue([
      {
        id: 'con-1',
        purpose: 'MARKETING',
        channel: 'EMAIL',
        status: 'GRANTED',
        occurred_at: new Date('2026-11-04T09:00:00.000Z'),
      },
    ]);

    const service = createService(prisma, 'SALES');
    const result = await service.getActivity('cust-1', {});

    expect(result.data.map((item) => item.type)).toEqual([
      'consent',
      'email',
      'invoice',
      'workshop_order',
    ]);
    expect(result.data[1].summary).not.toHaveProperty('body');
    expect(result.data[1].summary).toMatchObject({
      subject: 'Ihr Fahrzeug ist abholbereit',
      template_id: 'workshop_order_ready',
      status: 'ACCEPTED',
    });
    expect(result.data[2].ref_link).toBe('/sales/invoices/inv-1');
    expect(result.data[3].ref_link).toBe('/workshop/orders/wo-1');
  });

  it('filters out invoice and credit_note sources for a role without invoice.read', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      email: 'max@example.com',
    });
    prisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-1',
        order_number: 'WO-2026-001',
        status: 'INTAKE',
        purpose: 'CUSTOMER_REPAIR',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        vehicle: null,
      },
    ]);

    const service = createService(prisma, 'TECH');
    const result = await service.getActivity('cust-1', {});

    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(prisma.creditNote.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });

  it('masks redacted_fields in audit log entries for roles with customer.read', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      email: 'max@example.com',
    });
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'aud-1',
        action: 'UPDATE',
        actor_email: 'admin@example.com',
        actor_role: 'ADMIN',
        changed_fields: ['vat_id', 'city'],
        redacted_fields: ['vat_id'],
        before: { vat_id: 'ATU12345678', city: 'Wien' },
        after: { vat_id: 'ATU99999999', city: 'Graz' },
        diff: { vat_id: { from: 'ATU12345678', to: 'ATU99999999' }, city: { from: 'Wien', to: 'Graz' } },
        occurred_at: new Date('2026-11-05T10:00:00.000Z'),
      },
    ]);

    const service = createService(prisma, 'SALES');
    const result = await service.getActivity('cust-1', { types: 'audit' });

    expect(result.data).toHaveLength(1);
    const serialized = JSON.stringify(result.data[0]);
    expect(serialized).not.toContain('ATU12345678');
    expect(serialized).not.toContain('ATU99999999');
    expect(serialized).toContain('[REDACTED]');
    expect(result.data[0].summary).toMatchObject({
      action: 'UPDATE',
      redacted_fields: ['vat_id'],
    });
  });

  it('paginates across multiple sources with cursor without duplicates or gaps', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      email: 'max@example.com',
    });
    prisma.workshopOrder.findMany
      .mockResolvedValueOnce([
        {
          id: 'wo-2',
          order_number: 'WO-2',
          status: 'INTAKE',
          purpose: 'CUSTOMER_REPAIR',
          createdAt: new Date('2026-11-05T10:00:00.000Z'),
          vehicle: null,
        },
        {
          id: 'wo-1',
          order_number: 'WO-1',
          status: 'INTAKE',
          purpose: 'CUSTOMER_REPAIR',
          createdAt: new Date('2026-11-03T10:00:00.000Z'),
          vehicle: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'wo-1',
          order_number: 'WO-1',
          status: 'INTAKE',
          purpose: 'CUSTOMER_REPAIR',
          createdAt: new Date('2026-11-03T10:00:00.000Z'),
          vehicle: null,
        },
      ]);
    prisma.invoice.findMany
      .mockResolvedValueOnce([
        {
          id: 'inv-1',
          invoice_number: 'RE-1',
          draft_number: 'RE-D-1',
          status: 'FINALIZED',
          total_gross: '100.00',
          currency: 'EUR',
          date: new Date('2026-11-04T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    const service = createService(prisma, 'SALES');
    const page1 = await service.getActivity('cust-1', { limit: 2 });

    expect(page1.data.map((item) => item.ref_id)).toEqual(['wo-2', 'inv-1']);
    expect(page1.meta.hasNextPage).toBe(true);
    expect(page1.meta.nextCursor).toBeTruthy();

    const page2 = await service.getActivity('cust-1', {
      limit: 2,
      cursor: page1.meta.nextCursor ?? undefined,
    });
    expect(page2.data.map((item) => item.ref_id)).toEqual(['wo-1']);
    expect(page2.meta.hasNextPage).toBe(false);
    expect(page2.meta.nextCursor).toBeNull();
  });

  it('maps sales_order, credit_note, vehicle_notice, and loaner_booking items with record links', async () => {
    const prisma = createMockPrisma();
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      email: null,
    });
    prisma.vehicle.findMany.mockResolvedValue([{ id: 'veh-1' }]);
    prisma.vehicleParty.findMany.mockResolvedValue([{ vehicle_id: 'veh-2' }]);
    prisma.salesOrder.findMany.mockResolvedValue([
      {
        id: 'so-1',
        order_number: 'SO-2026-001',
        status: 'INVOICED',
        total_amount: '1500.00',
        createdAt: new Date('2026-11-04T10:00:00.000Z'),
      },
    ]);
    prisma.creditNote.findMany.mockResolvedValue([
      {
        id: 'cn-1',
        credit_number: 'GS-2026-001',
        status: 'FINALIZED',
        total_gross: '120.00',
        reason: 'Kulanz',
        createdAt: new Date('2026-11-03T10:00:00.000Z'),
      },
    ]);
    prisma.vehicleNotice.findMany.mockResolvedValue([
      {
        id: 'vn-1',
        vehicle_id: 'veh-1',
        type: 'SERVICE_DUE',
        title: 'Pickerl fällig',
        status: 'OPEN',
        due_date: new Date('2026-12-01T00:00:00.000Z'),
        createdAt: new Date('2026-11-02T10:00:00.000Z'),
        vehicle: { make: 'BMW', model: '320d', plate: 'W-999ZZ' },
      },
    ]);
    prisma.loanerBooking.findMany.mockResolvedValue([
      {
        id: 'lb-1',
        status: 'RETURNED',
        planned_from: new Date('2026-11-01T08:00:00.000Z'),
        planned_to: new Date('2026-11-01T17:00:00.000Z'),
        workshop_order_id: null,
        createdAt: new Date('2026-11-01T07:00:00.000Z'),
        loaner_vehicle: { display_name: 'Ersatzwagen Polo' },
      },
    ]);

    const service = createService(prisma, 'ADMIN');
    const result = await service.getActivity('cust-1', {
      types: 'sales_order,credit_note,vehicle_notice,loaner_booking',
    });

    expect(result.data.map((item) => [item.type, item.ref_link])).toEqual([
      ['sales_order', '/sales-orders/so-1'],
      ['credit_note', '/finance/credit-notes/cn-1'],
      ['vehicle_notice', '/vehicles/veh-1'],
      ['loaner_booking', '/workshop/loaner-vehicles'],
    ]);
  });
});
