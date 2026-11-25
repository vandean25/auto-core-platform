import { ForbiddenException } from '@nestjs/common';
import { AuditLogAction, CustomerNoteRetentionClass } from '@prisma/client';
import { CustomerNotesService } from './customer-notes.service.js';

const tenantId = 'tenant-1';
const customerId = 'cust-1';

function createService(
  role: string,
  overrides?: {
    erasureRestricted?: boolean;
    lastWorkshopAt?: Date | null;
    invoiceDate?: Date | null;
  },
) {
  const noteRow = {
    id: 'note-1',
    customer_id: customerId,
    body: 'Secret marker XYZ-123',
    pinned: false,
    author_member_id: 'mem-1',
    author_role: 'SALES',
    retention_class: CustomerNoteRetentionClass.OPERATIONAL,
    retain_until: new Date('2029-11-25T10:00:00.000Z'),
    legal_hold: false,
    erasure_restricted: overrides?.erasureRestricted ?? false,
    created_at: new Date('2026-11-25T10:00:00.000Z'),
    updated_at: new Date('2026-11-25T10:00:00.000Z'),
  };
  const prisma = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: customerId }) },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'mem-1', role: 'SALES' }),
    },
    workshopOrder: {
      groupBy: jest
        .fn()
        .mockResolvedValue(
          overrides?.lastWorkshopAt
            ? [
                {
                  customer_id: customerId,
                  _max: { createdAt: overrides.lastWorkshopAt },
                },
              ]
            : [],
        ),
    },
    salesOrder: { groupBy: jest.fn().mockResolvedValue([]) },
    invoice: {
      groupBy: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(
        overrides?.invoiceDate
          ? { id: 'inv-1', date: overrides.invoiceDate }
          : null,
      ),
    },
    creditNote: { findMany: jest.fn().mockResolvedValue([]) },
    loanerBooking: { groupBy: jest.fn().mockResolvedValue([]) },
    customerNote: {
      findMany: jest.fn().mockResolvedValue([noteRow]),
      findFirst: jest.fn().mockResolvedValue(noteRow),
      create: jest.fn().mockResolvedValue(noteRow),
      update: jest.fn().mockResolvedValue({ ...noteRow, pinned: true }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
  };
  const auditService = {
    recordTenantMutation: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CustomerNotesService(
    prisma as never,
    {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'user-1',
        role,
      }),
    } as never,
    auditService as never,
    {
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    } as never,
  );
  return { service, prisma, auditService };
}

describe('CustomerNotesService', () => {
  it.each(['ACCOUNTING', 'TECH', 'DEMO'])(
    'denies %s role on list, create, update, pin, and delete',
    async (role) => {
      const { service } = createService(role);
      await expect(service.list(customerId)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.create(customerId, { body: 'Note' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.update(customerId, 'note-1', { body: 'Edit' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.setPinned(customerId, 'note-1', true),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.remove(customerId, 'note-1')).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it('audits create, update, pin, and delete with sha256 hash and zero plaintext body', async () => {
    const { service, auditService, prisma } = createService('SALES');

    await service.create(customerId, { body: 'Secret marker XYZ-123' });
    await service.update(customerId, 'note-1', {
      body: 'Updated secret marker XYZ-456',
    });
    await service.setPinned(customerId, 'note-1', true);
    await service.remove(customerId, 'note-1');

    expect(prisma.customerNote.updateMany).toHaveBeenCalledWith({
      where: { id: 'note-1', tenant_id: tenantId },
      data: expect.objectContaining({
        body: null,
        pinned: false,
      }),
    });

    expect(auditService.recordTenantMutation).toHaveBeenCalledTimes(4);
    const serializedAudit = JSON.stringify(
      auditService.recordTenantMutation.mock.calls,
    );
    expect(serializedAudit).not.toContain('Secret marker XYZ-123');
    expect(serializedAudit).not.toContain('Updated secret marker XYZ-456');
    expect(auditService.recordTenantMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityType: 'CustomerNote',
        entityId: 'note-1',
        action: AuditLogAction.DELETE,
        source: 'CUSTOMER_NOTE_DELETE',
      }),
      prisma,
    );
  });

  it('excludes erasure_restricted notes in list and blocks update, pin, and delete', async () => {
    const { service, prisma } = createService('SALES', {
      erasureRestricted: true,
    });

    await service.list(customerId);
    expect(prisma.customerNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ erasure_restricted: false }),
      }),
    );

    await expect(
      service.update(customerId, 'note-1', { body: 'Edit' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.setPinned(customerId, 'note-1', true),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove(customerId, 'note-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('sets CLAIMS_3Y, server-side legal_hold, and invoice-close retain_until when invoice_id is provided', async () => {
    const invoiceDate = new Date('2025-05-14T10:00:00.000Z');
    const { service, prisma } = createService('SALES', { invoiceDate });

    await service.create(customerId, {
      body: 'Linked to invoice',
      invoice_id: 'inv-1',
    });

    expect(prisma.customerNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          retention_class: CustomerNoteRetentionClass.CLAIMS_3Y,
          legal_hold: true,
          retain_until: new Date('2028-12-31T23:59:59.999Z'),
        }),
      }),
    );
  });
});
