import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PendingActionExecutorService } from './pending-action-executor.service.js';

describe('PendingActionExecutorService', () => {
  const mockPrisma = {
    site: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    workshopOrder: { findFirst: jest.fn() },
    workshopTask: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000006',
        line_items_version: 0,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopTaskLineItem: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'line-item-1' }),
    },
    partsReservation: { findFirst: jest.fn() },
    importJob: { findFirst: jest.fn(), updateMany: jest.fn() },
    importJobRow: { updateMany: jest.fn(), groupBy: jest.fn() },
    customer: { findFirst: jest.fn() },
    documentBrandAsset: { updateMany: jest.fn() },
    registrationDocumentIntake: { findFirst: jest.fn() },
  };
  const mockRegistrationIntakeApply = { apply: jest.fn() };
  const mockWorkshopBookingPackage = {
    applyPackage: jest.fn().mockResolvedValue({
      id: 'order-1',
      entityId: 'order-1',
      workshop_order_id: 'order-1',
    }),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
  };
  const mockTenant = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const mockSite = { getSiteId: jest.fn().mockResolvedValue('site-1') };
  const mockWorkshop = {
    create: jest.fn().mockResolvedValue({ id: 'order-1' }),
    createAtSite: jest.fn().mockResolvedValue({ id: 'order-1' }),
  };
  const mockParts = {
    createOnHandReservation: jest
      .fn()
      .mockResolvedValue({ id: 'reservation-1' }),
    releaseReservation: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
  };
  const mockPurchaseService = {
    applyProposedPurchaseOrderDraft: jest.fn().mockResolvedValue({
      id: 'po-1',
      entityId: 'po-1',
      purchase_order_id: 'po-1',
      status: 'DRAFT',
    }),
    buildProposedPurchaseOrderExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
  };
  const mockWorkshopOrderCompletion = {
    applyCompletion: jest.fn().mockResolvedValue({
      id: 'order-1',
      entityId: 'order-1',
      workshop_order_id: 'order-1',
    }),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
  };
  const mockInvoiceWorkshopDraftPropose = {
    applyDraft: jest.fn().mockResolvedValue({
      id: 'inv-1',
      entityId: 'inv-1',
      invoice_id: 'inv-1',
      status: 'DRAFT',
    }),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 120 }),
  };
  const mockWorkshopEstimateSendPropose = {
    applySend: jest.fn().mockResolvedValue({
      id: 'ver-1',
      entityId: 'ver-1',
      estimate_version_id: 'ver-1',
      estimate_number: 'KV-2026-0001',
      status: 'SENT',
    }),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 60 }),
  };
  let service: PendingActionExecutorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PendingActionExecutorService(
      mockPrisma as never,
      mockTenant as never,
      mockSite as never,
      mockWorkshop as never,
      mockParts as never,
      mockRegistrationIntakeApply as never,
      mockWorkshopBookingPackage as never,
      mockPurchaseService as never,
      mockWorkshopOrderCompletion as never,
      mockInvoiceWorkshopDraftPropose as never,
      mockWorkshopEstimateSendPropose as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  describe('purchase_order.propose_draft', () => {
    it('binds site in execution context and delegates apply to purchase service', async () => {
      const executor = service.resolve('purchase_order.propose_draft');
      const context = await executor.buildExecutionContext?.({});
      expect(context).toEqual({ site_id: 'site-1' });
      await executor.execute(
        {
          vendor_id: '00000000-0000-4000-8000-000000000010',
          requisition_id: '00000000-0000-4000-8000-000000000011',
          lines: [
            {
              reservation_id: '00000000-0000-4000-8000-000000000012',
              catalog_item_id: '00000000-0000-4000-8000-000000000013',
              cost_basis: { version: 1, unit_cost_net: '10.00' },
            },
          ],
        },
        context,
      );
      expect(mockPurchaseService.applyProposedPurchaseOrderDraft).toHaveBeenCalled();
    });
  });

  describe('invoice.create_draft_from_workshop_order', () => {
    it('binds site in execution context and delegates apply to invoice draft service', async () => {
      const executor = service.resolve(
        'invoice.create_draft_from_workshop_order',
      );
      const context = await executor.buildExecutionContext?.({});
      expect(context).toEqual({ site_id: 'site-1' });
      await executor.execute(
        {
          workshop_order_id: '00000000-0000-4000-8000-000000000001',
        },
        context,
      );
      expect(mockInvoiceWorkshopDraftPropose.applyDraft).toHaveBeenCalled();
    });
  });

  describe('estimate.send_customer_message', () => {
    it('binds site and delegates apply like workshop_estimate.send', async () => {
      const executor = service.resolve('estimate.send_customer_message');
      const context = await executor.buildExecutionContext?.({});
      expect(context).toEqual({ site_id: 'site-1' });
      await executor.execute(
        {
          workshop_order_id: '00000000-0000-4000-8000-000000000001',
          channel: 'email',
        },
        context,
      );
      expect(mockWorkshopEstimateSendPropose.applySend).toHaveBeenCalled();
    });
  });

  describe('workshop_estimate.send', () => {
    it('binds site in execution context and delegates apply to estimate send service', async () => {
      const executor = service.resolve('workshop_estimate.send');
      const context = await executor.buildExecutionContext?.({});
      expect(context).toEqual({ site_id: 'site-1' });
      await executor.execute(
        {
          workshop_order_id: '00000000-0000-4000-8000-000000000001',
          channel: 'email',
        },
        context,
      );
      expect(mockWorkshopEstimateSendPropose.applySend).toHaveBeenCalled();
    });
  });

  describe('workshop_order.complete', () => {
    it('binds site in execution context and delegates apply to completion service', async () => {
      const executor = service.resolve('workshop_order.complete');
      const context = await executor.buildExecutionContext?.({});
      expect(context).toEqual({ site_id: 'site-1' });
      await executor.execute(
        {
          workshop_order_id: '00000000-0000-4000-8000-000000000001',
        },
        context,
      );
      expect(mockWorkshopOrderCompletion.applyCompletion).toHaveBeenCalled();
    });
  });

  describe('workshop.booking_package', () => {
    it('binds site in execution context and delegates apply to the package service', async () => {
      const executor = service.resolve('workshop.booking_package');
      const context = await executor.buildExecutionContext?.({});
      expect(context).toEqual({ site_id: 'site-1' });
      await executor.execute(
        {
          customer_id: '00000000-0000-4000-8000-000000000001',
          vehicle_id: '00000000-0000-4000-8000-000000000002',
          bay_id: '00000000-0000-4000-8000-000000000004',
          scheduled_start_at: '2026-10-12T09:00:00.000Z',
          scheduled_end_at: '2026-10-12T10:00:00.000Z',
        },
        context,
      );
      expect(mockWorkshopBookingPackage.applyPackage).toHaveBeenCalled();
    });
  });

  describe('registration_intake.apply', () => {
    const intakeId = '00000000-0000-4000-8000-0000000000a1';

    it('builds execution context from the intake site when the session site matches', async () => {
      mockPrisma.registrationDocumentIntake.findFirst.mockResolvedValue({
        site_id: 'site-1',
      });
      const executor = service.resolve('registration_intake.apply');
      const context = await executor.buildExecutionContext?.({
        intake_id: intakeId,
        vin: null,
        plate: 'W SYNTH 1',
        holder: { first_name: 'pilot', last_name: 'customer' },
        nationalcode: null,
        first_registration: null,
      });
      expect(context).toEqual({ site_id: 'site-1' });
    });

    it('returns not found when the intake belongs to another site', async () => {
      mockPrisma.registrationDocumentIntake.findFirst.mockResolvedValue({
        site_id: 'site-2',
      });
      const executor = service.resolve('registration_intake.apply');
      await expect(
        executor.buildExecutionContext?.({
          intake_id: intakeId,
          vin: null,
          plate: 'W SYNTH 1',
          holder: { first_name: 'pilot', last_name: 'customer' },
          nationalcode: null,
          first_registration: null,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('resolves workshop order creation to the current workshop operation', async () => {
    const executor = service.resolve('workshop_order.create');
    await executor.execute(
      {
        customer_id: '00000000-0000-4000-8000-000000000001',
        vehicle_id: '00000000-0000-4000-8000-000000000002',
        purpose: 'CUSTOMER_REPAIR',
        status: 'SCHEDULED',
        bay_id: '00000000-0000-4000-8000-000000000004',
        scheduled_start_at: '2026-10-12T09:00:00.000Z',
        scheduled_end_at: '2026-10-12T10:00:00.000Z',
      },
      { site_id: 'site-1' },
    );
    expect(executor.actionType).toBe('workshop_order.create');
    expect(mockWorkshop.createAtSite).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '00000000-0000-4000-8000-000000000001',
        purpose: 'CUSTOMER_REPAIR',
      }),
      'site-1',
    );
  });

  it('builds reservation policy context from tenant and active site data', async () => {
    mockPrisma.workshopTaskLineItem.findFirst.mockResolvedValue({
      unit_price: new Prisma.Decimal(25),
    });
    const executor = service.resolve('workshop_task.reserve_part');
    await executor.buildPolicyContext({
      workshop_task_line_item_id: '00000000-0000-4000-8000-000000000003',
      quantity: 1,
    });
    expect(mockTenant.getTenantId).toHaveBeenCalled();
    expect(mockSite.getSiteId).toHaveBeenCalled();
    expect(mockPrisma.workshopTaskLineItem.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000003',
        tenant_id: 'tenant-1',
        workshop_task: { workshop_order: { site_id: 'site-1' } },
      }),
      select: { unit_price: true },
    });
  });

  it('keeps reservation release on the existing inventory policy action key', () => {
    expect(service.resolve('inventory.part_release').actionType).toBe(
      'inventory.part_release',
    );
  });

  it('keeps reservation creation on the existing inventory policy action key', () => {
    expect(service.resolve('inventory.part_reserve').actionType).toBe(
      'inventory.part_reserve',
    );
  });

  it.each([
    { quantity: -1, unit_price_cents: 100 },
    { quantity: 1, unit_price_cents: -100 },
  ])(
    'rejects invalid proposed line financials before policy evaluation',
    async (line) => {
      const executor = service.resolve('workshop_order.propose_line');

      expect(() =>
        executor.buildPolicyContext({
          workshop_order_id: '00000000-0000-4000-8000-000000000007',
          workshop_task_id: '00000000-0000-4000-8000-000000000006',
          expected_line_items_version: 0,
          line_item: {
            type: 'PART',
            item_no: 'FABRICATED-PART-1',
            description: 'Fabricated test part',
            ...line,
          },
        }),
      ).toThrow(BadRequestException);
    },
  );

  it('resolves part reservation and release operations', async () => {
    await service.resolve('workshop_task.reserve_part').execute({
      workshop_task_line_item_id: '00000000-0000-4000-8000-000000000003',
      quantity: 2,
      location_id: '00000000-0000-4000-8000-000000000004',
    });
    await service.resolve('workshop_task.release_reservation').execute({
      reservation_id: '00000000-0000-4000-8000-000000000005',
    });
    expect(mockParts.createOnHandReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        workshopTaskLineItemId: '00000000-0000-4000-8000-000000000003',
        quantity: 2,
      }),
    );
    expect(mockParts.releaseReservation).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000005',
      {},
    );
  });

  it('executes a line-item action with tenant, site, and version scoping', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000007',
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
      tasks: [
        { id: '00000000-0000-4000-8000-000000000006', line_items_version: 0 },
      ],
    });
    const executor = service.resolve('workshop_order.propose_line');
    await executor.execute({
      workshop_order_id: '00000000-0000-4000-8000-000000000007',
      workshop_task_id: '00000000-0000-4000-8000-000000000006',
      expected_line_items_version: 0,
      line_item: {
        type: 'PART',
        item_no: 'TEST-1',
        description: 'Fabricated brake check',
        quantity: 1,
        unit_price_cents: 1500,
      },
    });
    expect(mockPrisma.workshopOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: '00000000-0000-4000-8000-000000000007',
          tenant_id: 'tenant-1',
          site_id: 'site-1',
        },
        include: expect.objectContaining({
          tasks: expect.objectContaining({
            where: expect.objectContaining({
              tenant_id: 'tenant-1',
              workshop_order: { tenant_id: 'tenant-1', site_id: 'site-1' },
            }),
          }),
        }),
      }),
    );
    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000006',
          tenant_id: 'tenant-1',
          line_items_version: 0,
        }),
      }),
    );
    expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledTimes(1);
  });

  it('refuses unknown action keys', () => {
    expect(() => service.resolve('workshop_order.delete')).toThrow(
      BadRequestException,
    );
  });
  describe('AUT-413 approvals of decision suggestions', () => {
    const importPayload = {
      import_job_id: 'job-1',
      row_no: 2,
      customer_id: 'customer-1',
    };
    const documentPayload = {
      document_brand_asset_id: 'asset-1',
      document_sort_type: 'Lieferschein',
    };
    const storedTotals = { rows: 2, create: 2, update: 0, skip: 0, error: 0 };

    beforeEach(() => {
      mockTenant.getTenantId.mockResolvedValue('tenant-1');
      mockPrisma.importJob.findFirst.mockResolvedValue({
        id: 'job-1',
        totals_json: storedTotals,
      });
      mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
      mockPrisma.importJobRow.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.importJobRow.groupBy.mockResolvedValue([
        { action: 'UPDATE', _count: { _all: 2 } },
      ]);
      mockPrisma.documentBrandAsset.updateMany.mockResolvedValue({ count: 1 });
    });

    it.each([
      ['a missing row_no', { row_no: undefined }],
      ['a non-integer row_no', { row_no: 1.5 }],
      ['a missing customer_id', { customer_id: undefined }],
    ])('rejects an import payload with %s', async (_label, override) => {
      const executor = service.resolve('decision.import_row_match');

      await expect(
        executor.execute({ ...importPayload, ...override }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.importJobRow.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a document type outside the allowed list before writing', async () => {
      const executor = service.resolve('decision.document_sort');

      await expect(
        executor.execute({ ...documentPayload, document_sort_type: 'Mietvertrag' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
    });

    it('refuses an import whose job is no longer awaiting confirmation', async () => {
      mockPrisma.importJob.findFirst.mockResolvedValueOnce(null);
      const executor = service.resolve('decision.import_row_match');

      await expect(executor.execute(importPayload)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(mockPrisma.importJobRow.updateMany).not.toHaveBeenCalled();
    });

    it('scopes the customer lookup to the approver tenant, so a foreign customer is not found', async () => {
      mockPrisma.customer.findFirst.mockResolvedValueOnce(null);
      mockTenant.getTenantId.mockResolvedValue('tenant-2');
      const executor = service.resolve('decision.import_row_match');

      await expect(executor.execute(importPayload)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-1', tenant_id: 'tenant-2' },
        }),
      );
      expect(mockPrisma.importJobRow.updateMany).not.toHaveBeenCalled();
    });

    it('conflicts when the row is no longer CREATE and changes no totals', async () => {
      mockPrisma.importJobRow.updateMany.mockResolvedValueOnce({ count: 0 });
      const executor = service.resolve('decision.import_row_match');

      await expect(executor.execute(importPayload)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('recounts totals from the rows instead of adjusting the stored snapshot', async () => {
      // Stored totals still say two CREATE rows. Another approval already moved
      // row 1 to UPDATE, and this approval moved row 2, so the rows now say two UPDATE.
      const executor = service.resolve('decision.import_row_match');

      await executor.execute(importPayload);

      const lockWrite = mockPrisma.importJob.updateMany.mock.calls[0][0];
      expect(lockWrite.data).toEqual({ totals_json: storedTotals });
      expect(
        mockPrisma.importJob.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(mockPrisma.importJobRow.groupBy.mock.invocationCallOrder[0]);
      expect(mockPrisma.importJobRow.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-1', import_job_id: 'job-1' },
        }),
      );
      const totalsWrite = mockPrisma.importJob.updateMany.mock.calls[1][0];
      expect(totalsWrite.data).toEqual({
        totals_json: { rows: 2, create: 0, update: 2, skip: 0, error: 0 },
      });
    });

    it('fails the approval when the job lock touches no row', async () => {
      mockPrisma.importJob.updateMany.mockResolvedValueOnce({ count: 0 });
      const executor = service.resolve('decision.import_row_match');

      await expect(executor.execute(importPayload)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.importJob.updateMany).toHaveBeenCalledTimes(1);
    });

    it('fails the approval when the totals write touches no row', async () => {
      mockPrisma.importJob.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const executor = service.resolve('decision.import_row_match');

      await expect(executor.execute(importPayload)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('sets a document type only on a READY asset of the approver tenant', async () => {
      const executor = service.resolve('decision.document_sort');

      await expect(executor.execute(documentPayload)).resolves.toEqual({
        id: 'asset-1',
        entityId: 'asset-1',
      });
      expect(mockPrisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'asset-1',
          tenant_id: 'tenant-1',
          state: 'READY',
          document_sort_type: null,
        },
        data: { document_sort_type: 'Lieferschein' },
      });
    });

    it('conflicts when the type is already set or the asset is not READY', async () => {
      mockPrisma.documentBrandAsset.updateMany.mockResolvedValueOnce({ count: 0 });
      const executor = service.resolve('decision.document_sort');

      await expect(executor.execute(documentPayload)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('never matches another tenant document asset', async () => {
      mockPrisma.documentBrandAsset.updateMany.mockResolvedValueOnce({ count: 0 });
      mockTenant.getTenantId.mockResolvedValue('tenant-2');
      const executor = service.resolve('decision.document_sort');

      await expect(executor.execute(documentPayload)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.documentBrandAsset.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'tenant-2' }),
        }),
      );
    });
  });
});
