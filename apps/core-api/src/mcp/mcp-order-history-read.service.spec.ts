import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CustomerService } from '../customer/customer.service.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { encodeMcpKeysetCursor } from './mcp-output.util.js';

const TENANT_ID = 'tenant-a';
const SITE_ID = 'site-a';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const VEHICLE_ID = '00000000-0000-4000-8000-0000000000d1';
const WORKSHOP_ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const SALES_ORDER_ID = '00000000-0000-4000-8000-0000000000e2';
const INVOICE_ID = '00000000-0000-4000-8000-0000000000f1';

const VEHICLE = {
  id: VEHICLE_ID,
  plate: 'TS-100 A',
  make: 'Testmarke',
  model: 'Modell T',
};

type OrderModel = { findMany: jest.Mock };

function orderModel(): OrderModel {
  return { findMany: jest.fn().mockResolvedValue([]) };
}

function whereOf(model: OrderModel): Record<string, unknown> {
  return model.findMany.mock.calls[0][0].where as Record<string, unknown>;
}

describe('McpOrderHistoryReadService', () => {
  let service: McpOrderHistoryReadService;
  let workshopOrder: OrderModel;
  let salesOrder: OrderModel;
  let invoice: OrderModel;
  let vehicle: { findFirst: jest.Mock };
  let customerService: { findOne: jest.Mock };
  let documentReads: { listDocuments: jest.Mock };

  beforeEach(() => {
    workshopOrder = orderModel();
    salesOrder = orderModel();
    invoice = orderModel();
    vehicle = { findFirst: jest.fn().mockResolvedValue(null) };
    customerService = {
      findOne: jest.fn().mockResolvedValue({
        id: CUSTOMER_ID,
        tenant_id: TENANT_ID,
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Testa',
        last_name: 'Kundin',
        email: 'kundin@example.test',
        phone: null,
        vat_id: null,
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: 'AT',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        vehicles: [{ id: VEHICLE_ID, make: 'Testmarke', model: 'Modell T' }],
        sales_orders: [{ id: 'nested-sales-order' }],
        workshop_orders: [{ id: 'nested-workshop-order' }],
        invoices: [{ id: 'nested-invoice', snapshot: { big: true } }],
        workshop_orders_meta: { total: 1 },
        invoices_meta: { total: 1 },
      }),
    };
    documentReads = {
      listDocuments: jest.fn().mockResolvedValue({
        data: [],
        meta: { page_size: 10, next_cursor: null },
        truncated: false,
      }),
    };
    service = new McpOrderHistoryReadService(
      {
        workshopOrder,
        salesOrder,
        invoice,
        vehicle,
      } as unknown as PrismaService,
      {
        getSiteId: jest.fn().mockResolvedValue(SITE_ID),
      } as unknown as SiteContextService,
      {
        getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      } as unknown as TenantContextService,
      customerService as unknown as CustomerService,
      documentReads as unknown as McpDocumentReadService,
    );
  });

  describe('getCustomer', () => {
    it('returns the contact data and vehicles, and drops the nested REST history arrays', async () => {
      const result = await service.getCustomer({ customer_id: CUSTOMER_ID });

      expect(result).toEqual({
        id: CUSTOMER_ID,
        tenant_id: TENANT_ID,
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Testa',
        last_name: 'Kundin',
        email: 'kundin@example.test',
        phone: null,
        vat_id: null,
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: 'AT',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        vehicles: [{ id: VEHICLE_ID, make: 'Testmarke', model: 'Modell T' }],
        orders: {
          data: [],
          meta: { page_size: 10, next_cursor: null },
          truncated: false,
        },
      });
      for (const key of [
        'sales_orders',
        'workshop_orders',
        'invoices',
        'workshop_orders_meta',
        'invoices_meta',
      ]) {
        expect(result).not.toHaveProperty(key);
      }
    });

    it('loads the customer with one history row, so the nested lists stay small', async () => {
      await service.getCustomer({ customer_id: CUSTOMER_ID });

      expect(customerService.findOne).toHaveBeenCalledWith(CUSTOMER_ID, {
        historyPage: 1,
        historyLimit: 1,
      });
    });

    it('lists workshop and sales orders together, newest first, with the invoice gross total', async () => {
      workshopOrder.findMany.mockResolvedValue([
        {
          id: WORKSHOP_ORDER_ID,
          order_number: 'WO-2026-0007',
          status: 'INVOICED',
          createdAt: new Date('2026-09-01T08:00:00.000Z'),
          vehicle: VEHICLE,
        },
      ]);
      salesOrder.findMany.mockResolvedValue([
        {
          id: SALES_ORDER_ID,
          order_number: 'SO-2026-1001',
          status: 'CONFIRMED',
          createdAt: new Date('2026-09-10T08:00:00.000Z'),
          vehicle: null,
        },
      ]);
      invoice.findMany.mockResolvedValue([
        {
          workshop_order_id: WORKSHOP_ORDER_ID,
          sales_order_id: null,
          status: 'PAID',
          total_gross: new Prisma.Decimal('174.00'),
          snapshot: null,
        },
      ]);

      const result = await service.getCustomer({ customer_id: CUSTOMER_ID });

      expect(result.orders.data).toEqual([
        {
          id: SALES_ORDER_ID,
          kind: 'sales_order',
          number: 'SO-2026-1001',
          status: 'CONFIRMED',
          vehicle: null,
          date: '2026-09-10T08:00:00.000Z',
          total_gross: null,
        },
        {
          id: WORKSHOP_ORDER_ID,
          kind: 'workshop_order',
          number: 'WO-2026-0007',
          status: 'INVOICED',
          vehicle: VEHICLE,
          date: '2026-09-01T08:00:00.000Z',
          total_gross: '174.00',
        },
      ]);
    });

    it('shows no total while the linked invoice is still a draft', async () => {
      workshopOrder.findMany.mockResolvedValue([
        {
          id: WORKSHOP_ORDER_ID,
          order_number: 'WO-2026-0007',
          status: 'COMPLETED',
          createdAt: new Date('2026-09-01T08:00:00.000Z'),
          vehicle: VEHICLE,
        },
      ]);
      salesOrder.findMany.mockResolvedValue([]);
      invoice.findMany.mockResolvedValue([
        {
          workshop_order_id: WORKSHOP_ORDER_ID,
          sales_order_id: null,
          status: 'DRAFT',
          total_gross: new Prisma.Decimal('174.00'),
          snapshot: null,
        },
      ]);

      const result = await service.getCustomer({ customer_id: CUSTOMER_ID });

      expect(result.orders.data).toEqual([
        expect.objectContaining({ id: WORKSHOP_ORDER_ID, total_gross: null }),
      ]);
    });

    it('keeps the total of a cancelled invoice, as list_invoices does', async () => {
      workshopOrder.findMany.mockResolvedValue([
        {
          id: WORKSHOP_ORDER_ID,
          order_number: 'WO-2026-0007',
          status: 'INVOICED',
          createdAt: new Date('2026-09-01T08:00:00.000Z'),
          vehicle: VEHICLE,
        },
      ]);
      salesOrder.findMany.mockResolvedValue([]);
      invoice.findMany.mockResolvedValue([
        {
          workshop_order_id: WORKSHOP_ORDER_ID,
          sales_order_id: null,
          status: 'CANCELLED',
          total_gross: new Prisma.Decimal('174.00'),
          snapshot: null,
        },
      ]);

      const result = await service.getCustomer({ customer_id: CUSTOMER_ID });

      expect(result.orders.data).toEqual([
        expect.objectContaining({
          id: WORKSHOP_ORDER_ID,
          total_gross: '174.00',
        }),
      ]);
    });

    it('shows the last ten orders by default', async () => {
      workshopOrder.findMany.mockResolvedValue(
        Array.from({ length: 11 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${(0x400 + index).toString(16).padStart(12, '0')}`,
          order_number: `WO-2026-${index}`,
          status: 'COMPLETED',
          createdAt: new Date(Date.UTC(2026, 8, 30) - index * 3_600_000),
          vehicle: VEHICLE,
        })),
      );

      const result = await service.getCustomer({ customer_id: CUSTOMER_ID });

      expect(workshopOrder.findMany.mock.calls[0][0].take).toBe(11);
      expect(result.orders.data).toHaveLength(10);
      expect(result.orders.meta).toEqual({
        page_size: 10,
        next_cursor: expect.any(String),
      });
    });

    it('caps an order page at 25 rows and asks each table for one extra row', async () => {
      const result = await service.getCustomer({
        customer_id: CUSTOMER_ID,
        orders_page_size: 40,
      });

      expect(workshopOrder.findMany.mock.calls[0][0].take).toBe(26);
      expect(salesOrder.findMany.mock.calls[0][0].take).toBe(26);
      expect(result.orders.meta.page_size).toBe(25);
    });

    it('returns a cursor when more orders exist, and resumes strictly after it', async () => {
      const rows = Array.from({ length: 26 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${(0x200 + index).toString(16).padStart(12, '0')}`,
        order_number: `WO-2026-${index}`,
        status: 'COMPLETED',
        createdAt: new Date(Date.UTC(2026, 8, 30) - index * 3_600_000),
        vehicle: VEHICLE,
      }));
      workshopOrder.findMany.mockResolvedValue(rows);

      const first = await service.getCustomer({
        customer_id: CUSTOMER_ID,
        orders_page_size: 25,
      });
      expect(first.orders.data).toHaveLength(25);
      expect(first.orders.meta.next_cursor).not.toBeNull();

      await service.getCustomer({
        customer_id: CUSTOMER_ID,
        orders_page_size: 25,
        orders_cursor: first.orders.meta.next_cursor ?? undefined,
      });
      const secondWhere = workshopOrder.findMany.mock.calls[1][0].where;
      expect(secondWhere.AND).toEqual([
        {
          OR: [
            { createdAt: { lt: rows[24].createdAt } },
            { createdAt: rows[24].createdAt, id: { lt: rows[24].id } },
          ],
        },
      ]);
    });

    it('scopes order queries to the tenant, the active site, and the customer', async () => {
      await service.getCustomer({ customer_id: CUSTOMER_ID });

      for (const model of [workshopOrder, salesOrder]) {
        expect(whereOf(model)).toEqual(
          expect.objectContaining({
            tenant_id: TENANT_ID,
            site_id: SITE_ID,
            customer_id: CUSTOMER_ID,
          }),
        );
      }
    });

    it('rejects an orders cursor that is not a keyset cursor', async () => {
      await expect(
        service.getCustomer({
          customer_id: CUSTOMER_ID,
          orders_cursor: 'not-a-cursor',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('propagates not found for a customer outside the tenant', async () => {
      customerService.findOne.mockRejectedValue(
        new NotFoundException(`Customer with ID ${CUSTOMER_ID} not found`),
      );

      await expect(
        service.getCustomer({ customer_id: CUSTOMER_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getVehicleHistory', () => {
    const inspections = Array.from({ length: 12 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${(0x300 + index).toString(16).padStart(12, '0')}`,
      inspection_type: 'PICKERL',
      inspected_on: new Date(Date.UTC(2026, 2, 1) - index * 365 * 86_400_000),
      plaketten_valid_until_year: 2028 - index,
      plaketten_valid_until_month: 3,
      station_name: 'Prüfstelle Test',
    }));

    beforeEach(() => {
      vehicle.findFirst.mockResolvedValue({
        id: VEHICLE_ID,
        make: 'Testmarke',
        model: 'Modell T',
        year: 2019,
        plate: 'TS-100 A',
        first_registration_date: new Date('2019-03-01T00:00:00.000Z'),
        inspection_records: inspections,
      });
    });

    it('returns identity, Pickerl status, orders, the newest ten inspections, and the first document page', async () => {
      const result = await service.getVehicleHistory({
        vehicle_id: VEHICLE_ID,
      });

      expect(result.vehicle).toEqual({
        id: VEHICLE_ID,
        make: 'Testmarke',
        model: 'Modell T',
        year: 2019,
        plate: 'TS-100 A',
      });
      expect(result.pickerl_due).toEqual(
        expect.objectContaining({
          last_inspected_on: '2026-03-01',
        }),
      );
      expect(result.inspections.data).toHaveLength(10);
      expect(result.inspections.meta).toEqual({ total: 12 });
      expect(result.inspections.data[0]).toEqual({
        id: inspections[0].id,
        inspection_type: 'PICKERL',
        inspected_on: '2026-03-01',
        plaketten_valid_until: '2028-03',
        station_name: 'Prüfstelle Test',
      });
      expect(documentReads.listDocuments).toHaveBeenCalledWith({
        entity_type: 'vehicle',
        entity_id: VEHICLE_ID,
        pageSize: 10,
      });
      expect(result.documents).toEqual({
        data: [],
        meta: { page_size: 10, next_cursor: null },
        truncated: false,
      });
    });

    it('scopes the vehicle lookup to the tenant and the vehicle orders to the active site', async () => {
      await service.getVehicleHistory({ vehicle_id: VEHICLE_ID });

      expect(vehicle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VEHICLE_ID, tenant_id: TENANT_ID },
        }),
      );
      for (const model of [workshopOrder, salesOrder]) {
        expect(whereOf(model)).toEqual(
          expect.objectContaining({
            tenant_id: TENANT_ID,
            site_id: SITE_ID,
            vehicle_id: VEHICLE_ID,
          }),
        );
        expect(whereOf(model)).not.toHaveProperty('customer_id');
      }
    });

    it('caps the order page the same way as the customer list', async () => {
      await service.getVehicleHistory({
        vehicle_id: VEHICLE_ID,
        orders_page_size: 99,
      });

      expect(workshopOrder.findMany.mock.calls[0][0].take).toBe(26);
    });

    it('rejects a vehicle outside the tenant and loads no history', async () => {
      vehicle.findFirst.mockResolvedValue(null);

      await expect(
        service.getVehicleHistory({ vehicle_id: VEHICLE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(workshopOrder.findMany).not.toHaveBeenCalled();
      expect(documentReads.listDocuments).not.toHaveBeenCalled();
    });

    it('accepts a well-formed orders cursor from an earlier page', async () => {
      const cursor = encodeMcpKeysetCursor({
        at: '2026-09-01T08:00:00.000Z',
        id: INVOICE_ID,
      });

      await expect(
        service.getVehicleHistory({
          vehicle_id: VEHICLE_ID,
          orders_cursor: cursor,
        }),
      ).resolves.toEqual(
        expect.objectContaining({ orders: expect.any(Object) }),
      );
    });
  });
});
