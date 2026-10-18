import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopLineItemType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import { syncWorkshopEstimateOverrunAfterWrite } from '../workshop/workshop-estimate-overrun-sync.js';
import { incrementTaskLineItemsVersion } from '../workshop/workshop-task-line-items.helpers.js';
import {
  partExecutionStatusForNewLine,
  resolveWorkshopLineItemType,
} from '../workshop/workshop-line-item-type.helpers.js';
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import { proposeLineItemInputSchema } from '../mcp/mcp-tool-schemas.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { asRecord } from './pending-action-executor.util.js';

export function proposeLinePolicyContext(
  input: unknown,
): AgentPolicyEvaluateContext {
  const parsed = proposeLineItemInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException('Invalid proposed line item payload');
  }
  return {
    amount_eur:
      (parsed.data.line_item.quantity *
        parsed.data.line_item.unit_price_cents) /
      100,
  };
}

export async function addLineItem(
  deps: {
    prisma: PrismaService;
    tenantContext: TenantContextService;
    siteContext: SiteContextService;
  },
  input: unknown,
  validatedLine?: Record<string, unknown>,
): Promise<unknown> {
  const result = await addLineItemWithoutSync(deps, input, validatedLine);
  const record = asRecord(input);
  const orderId =
    typeof record.workshop_order_id === 'string'
      ? record.workshop_order_id
      : typeof record.order_id === 'string'
        ? record.order_id
        : null;
  if (orderId) {
    await syncWorkshopEstimateOverrunAfterWrite(
      deps.prisma,
      deps.siteContext,
      await deps.tenantContext.getTenantId(),
      orderId,
    );
  }
  return result;
}

export async function addProposedLineItem(
  deps: {
    prisma: PrismaService;
    tenantContext: TenantContextService;
    siteContext: SiteContextService;
  },
  input: unknown,
): Promise<unknown> {
  const parsed = proposeLineItemInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException('Invalid proposed line item payload');
  }
  return addLineItem(deps, input, parsed.data.line_item);
}

/** A proposed line changes the estimate lines, so an overrun is recorded once it is written (AUT-355). */
export async function addLineItemWithoutSync(
  deps: {
    prisma: PrismaService;
    tenantContext: TenantContextService;
    siteContext: SiteContextService;
  },
  input: unknown,
  validatedLine?: Record<string, unknown>,
): Promise<unknown> {
  const { prisma, tenantContext, siteContext } = deps;
  const record = asRecord(input);
  const parsed = proposeLineItemInputSchema.safeParse(input);
  const line: Record<string, unknown> =
    validatedLine ??
    (parsed.success
      ? parsed.data.line_item
      : asRecord(record.line_item ?? record));
  const [tenantId, siteId] = await Promise.all([
    tenantContext.getTenantId(),
    siteContext.getSiteId(),
  ]);
  const orderId =
    typeof record.workshop_order_id === 'string'
      ? record.workshop_order_id
      : typeof record.order_id === 'string'
        ? record.order_id
        : '';
  const payloadSiteId = record.site_id ?? record.siteId;
  if (
    payloadSiteId !== undefined &&
    payloadSiteId !== null &&
    typeof payloadSiteId !== 'string'
  ) {
    throw new BadRequestException('Action payload site must be a string');
  }
  if (payloadSiteId && payloadSiteId !== siteId) {
    throw new BadRequestException(
      `Action payload site (${payloadSiteId}) does not match caller authorized site (${siteId})`,
    );
  }
  const callerSite = await prisma.site.updateMany({
    where: { id: siteId, tenant_id: tenantId, is_active: true },
    data: { is_active: true },
  });
  if (callerSite.count !== 1) {
    throw new UnprocessableEntityException(
      'The active site is no longer available',
    );
  }
  const order = await prisma.workshopOrder.findFirst({
    where: {
      id: orderId,
      tenant_id: tenantId,
      site_id: siteId,
    },
    include: {
      tasks: {
        where: {
          tenant_id: tenantId,
          workshop_order: { tenant_id: tenantId, site_id: siteId },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!order)
    throw new NotFoundException(`Workshop order ${orderId} not found`);
  assertOrderEditable(order);

  const taskId = (record.workshop_task_id ?? record.task_id) as
    string | undefined;
  let task = taskId
    ? order.tasks.find((candidate) => candidate.id === taskId)
    : order.tasks[0];
  if (!task && taskId) {
    throw new NotFoundException(
      `Workshop task ${taskId} not found on order ${orderId}`,
    );
  }
  if (!task) {
    task = await prisma.workshopTask.create({
      data: {
        tenant_id: tenantId,
        workshop_order_id: order.id,
        title: 'General Service',
      },
    });
  }
  const expectedVersion = Number(
    record.expected_line_items_version ?? task.line_items_version,
  );
  await incrementTaskLineItemsVersion({
    tx: prisma,
    tenantId,
    siteId,
    taskId: task.id,
    expectedLineItemsVersion: expectedVersion,
  });
  const unitPrice =
    line.unit_price_cents !== undefined
      ? Number(line.unit_price_cents) / 100
      : Number(line.unit_price ?? line.unitPrice ?? 0);
  const lineType = resolveWorkshopLineItemType(String(line.type));
  const isLabor = lineType === WorkshopLineItemType.LABOR;
  const created = await prisma.workshopTaskLineItem.create({
    data: {
      tenant_id: tenantId,
      workshop_task_id: task.id,
      type: lineType,
      part_execution_status: partExecutionStatusForNewLine(lineType),
      item_no: typeof line.item_no === 'string' ? line.item_no : 'MISC',
      description:
        typeof line.description === 'string'
          ? line.description
          : 'Proposed line item',
      quantity: new Prisma.Decimal(Number(line.quantity ?? 1)),
      unit_price: new Prisma.Decimal(unitPrice),
      labor_operation_id: isLabor
        ? ((line.labor_operation_id as string | undefined) ?? null)
        : null,
    },
    select: { id: true },
  });
  return { id: created.id, entityId: created.id };
}
