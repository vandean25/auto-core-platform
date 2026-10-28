import { WorkshopLineItemType, WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import type { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import type { WorkshopMechanicFindingService } from '../workshop/workshop-mechanic-finding.service.js';
import { computeWorkshopLaborSummary } from '../workshop/workshop-labor-summary.helpers.js';
import { McpWorkshopOrderDetailReadService } from './mcp-workshop-order-detail.read.service.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000d1';

function orderDetail() {
  const tasks = [
    {
      id: 'task-1',
      title: 'Oil change',
      status: 'IN_PROGRESS',
      lineItemsVersion: 0,
      done: false,
      lineItems: [
        {
          id: 'line-1',
          type: WorkshopLineItemType.PART,
          itemNo: 'OIL-FLTR',
          description: 'Oil filter',
          qty: 1,
          unitPrice: 15,
          standardAw: null,
          actualHours: null,
          internalCostRate: null,
        },
        {
          id: 'line-2',
          type: WorkshopLineItemType.LABOR,
          itemNo: 'LAB-01',
          description: 'Oil change labor',
          qty: 0.5,
          unitPrice: 80,
          standardAw: 0.5,
          actualHours: 0.75,
          internalCostRate: 30,
        },
      ],
    },
  ];

  return {
    id: ORDER_ID,
    tenant_id: '00000000-0000-4000-8000-000000000001',
    site_id: '00000000-0000-4000-8000-000000000002',
    order_number: 'WO-2026-0001',
    status: WorkshopOrderStatus.IN_PROGRESS,
    purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
    customer_id: null,
    vehicle_id: '00000000-0000-4000-8000-000000000003',
    staging_location_id: null,
    mechanic_id: null,
    bay_id: null,
    odometer: 120000,
    fuel_level: 50,
    reported_issue: null,
    notes: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    updatedAt: new Date('2026-10-01T08:00:00.000Z'),
    invoice: null,
    vehicle: { id: 'vehicle-1', make: 'Demo', model: 'Car', plate: 'W-DEMO-1' },
    tasks,
    labor_summary: computeWorkshopLaborSummary(tasks),
  };
}

function buildService(order = orderDetail()) {
  const workshopIntake = {
    findOne: jest.fn().mockResolvedValue(order),
  };
  const mechanicFindings = {
    listForOrder: jest
      .fn()
      .mockResolvedValue({ data: [{ id: 'finding-1' }] }),
  };

  const service = new McpWorkshopOrderDetailReadService(
    workshopIntake as unknown as WorkshopIntakeService,
    mechanicFindings as unknown as WorkshopMechanicFindingService,
  );

  return { service, workshopIntake, mechanicFindings };
}

describe('McpWorkshopOrderDetailReadService', () => {
  it('adds labor margin and efficiency as MCP decimal strings', async () => {
    const { service } = buildService();

    const result = await service.getWorkshopOrder({
      workshop_order_id: ORDER_ID,
    });

    expect(result.labor_summary).toEqual({
      line_items: [
        {
          id: 'line-2',
          task_id: 'task-1',
          revenue: '40.00',
          cost: '22.50',
          margin: '17.50',
          efficiency: '0.67',
        },
      ],
      totals: {
        revenue: '40.00',
        cost: '22.50',
        margin: '17.50',
        margin_percent: '43.75',
        standard_hours: '0.50',
        actual_hours: '0.75',
        efficiency: '0.67',
      },
      has_cost_data: true,
    });
    expect(result.mechanic_findings).toEqual([{ id: 'finding-1' }]);
  });

  it('passes the order id to the detail and mechanic-finding reads', async () => {
    const { service, workshopIntake, mechanicFindings } = buildService();

    await service.getWorkshopOrder({ workshop_order_id: ORDER_ID });

    expect(workshopIntake.findOne).toHaveBeenCalledWith(ORDER_ID);
    expect(mechanicFindings.listForOrder).toHaveBeenCalledWith(ORDER_ID);
  });

  it('satisfies the published get_workshop_order output schema', async () => {
    const { service } = buildService();

    const result = await service.getWorkshopOrder({
      workshop_order_id: ORDER_ID,
    });

    const parsed = mcpToolOutputSchemas.get_workshop_order.safeParse(
      toMcpJsonObject(result),
    );
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('keeps cost and margin null when the labor line has no cost rate', async () => {
    const order = orderDetail();
    order.tasks[0].lineItems[1].internalCostRate = null;
    order.labor_summary = computeWorkshopLaborSummary(order.tasks);
    const { service } = buildService(order);

    const result = await service.getWorkshopOrder({
      workshop_order_id: ORDER_ID,
    });

    expect(result.labor_summary.totals).toMatchObject({
      revenue: '40.00',
      cost: null,
      margin: null,
      margin_percent: null,
    });
    expect(result.labor_summary.has_cost_data).toBe(false);
  });
});
