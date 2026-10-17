import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  Prisma,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service.js';
import { assertBackOfficeRole } from './workshop-estimate-scope.js';
import { wakeUpAfterCommit } from './workshop-estimate-email-queue.js';
import { WorkshopOrderReadyEmailService } from './workshop-order-ready-email.service.js';
import { resolveReadyEmailNotice } from './workshop-order-ready-notice.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import {
  assertOrderEditable,
  deriveOrderStatus,
} from './workshop-order.helpers.js';
import {
  applyDerivedOrderStatusWithStockPrep,
  executeTaskUpdateTransaction,
} from './workshop-task.helpers.js';
import {
  proposeWorkshopOrderCompletionInputSchema,
  type ProposeWorkshopOrderCompletionInput,
} from './workshop-order-completion.schema.js';

const OPEN_RESERVATION_STATUSES: PartsReservationStatus[] = [
  PartsReservationStatus.OPEN,
  PartsReservationStatus.ORDERED,
  PartsReservationStatus.STAGED,
];

export type WorkshopOrderCompletionTaskTransition = {
  workshop_task_id: string;
  previous_status: WorkshopTaskStatus;
  new_status: 'DONE';
};

export type WorkshopOrderCompletionOpenReservation = {
  reservation_id: string;
  status: PartsReservationStatus;
  workshop_task_line_item_id: string;
};

export type WorkshopOrderCompletionReadyEmailPreview = {
  notify_customer: boolean;
  will_send: boolean;
  notice_code: string | null;
};

export type WorkshopOrderCompletionResult = {
  id: string;
  entityId: string;
  workshop_order_id: string;
  site_id: string;
  order_status: {
    previous: WorkshopOrderStatus;
    new: WorkshopOrderStatus;
  };
  tasks: WorkshopOrderCompletionTaskTransition[];
  open_parts_reservations: WorkshopOrderCompletionOpenReservation[];
  warnings: string[];
  ready_email: WorkshopOrderCompletionReadyEmailPreview;
};

@Injectable()
export class WorkshopOrderCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly vehicleLedger: VehicleLedgerService,
    private readonly readyEmail: WorkshopOrderReadyEmailService,
    private readonly wakeUps: NotificationCloudTasksService,
  ) {}

  async buildExecutionContext(): Promise<Record<string, unknown>> {
    const siteId = await this.siteContext.getSiteId();
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    return { site_id: siteId };
  }

  async applyCompletion(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<WorkshopOrderCompletionResult> {
    assertBackOfficeRole(
      this.tenantContext,
      'Completing workshop orders through MCP',
    );
    const parsed = proposeWorkshopOrderCompletionInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const expectedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : await this.siteContext.getSiteId();

    const plan = await this.planCompletion(parsed, tenantId, expectedSiteId);

    let queuedOutboxId: string | null = null;
    const completion = await this.prisma.$transaction(async (tx) => {
      if (parsed.odometer_out !== undefined || parsed.notes !== undefined) {
        const orderUpdate: Prisma.WorkshopOrderUpdateManyMutationInput = {};
        if (parsed.odometer_out !== undefined) {
          orderUpdate.odometer = parsed.odometer_out;
        }
        if (parsed.notes !== undefined) {
          orderUpdate.notes = parsed.notes;
        }
        const updated = await tx.workshopOrder.updateMany({
          where: {
            id: parsed.workshop_order_id,
            tenant_id: tenantId,
            site_id: expectedSiteId,
          },
          data: orderUpdate,
        });
        if (updated.count === 0) {
          throw new NotFoundException(
            `Workshop order ${parsed.workshop_order_id} not found`,
          );
        }
      }

      const taskTransitions: WorkshopOrderCompletionTaskTransition[] = [];
      for (const taskId of plan.taskIdsToComplete) {
        const before = plan.tasksById.get(taskId);
        if (!before || before.status === WorkshopTaskStatus.DONE) {
          continue;
        }
        await executeTaskUpdateTransaction({
          tx,
          tenantId,
          siteId: expectedSiteId,
          orderId: parsed.workshop_order_id,
          taskId,
          dto: { status: WorkshopTaskStatus.DONE },
          applyDerivedStatus: async (t, ten, ord, next) => {
            let outboxId: string | null = null;
            const applied = await applyDerivedOrderStatusWithStockPrep(
              this.vehicleLedger,
              {
                tx: t,
                tenantId: ten,
                siteId: expectedSiteId,
                orderId: ord,
                nextOrderStatus: next,
              },
              parsed.notify_customer
                ? async (trx, tid, sid, oid) => {
                    outboxId = await this.readyEmail.onOrderCompletedInTx(
                      trx,
                      {
                        tenantId: tid,
                        siteId: sid,
                        orderId: oid,
                        occurredAt: new Date(),
                      },
                    );
                  }
                : undefined,
            );
            if (outboxId) {
              queuedOutboxId = outboxId;
            }
            return applied;
          },
        });
        taskTransitions.push({
          workshop_task_id: taskId,
          previous_status: before.status,
          new_status: 'DONE',
        });
      }

      const order = await tx.workshopOrder.findFirstOrThrow({
        where: {
          id: parsed.workshop_order_id,
          tenant_id: tenantId,
          site_id: expectedSiteId,
        },
        select: {
          id: true,
          status: true,
          purpose: true,
          order_number: true,
          customer: {
            select: {
              id: true,
              contact_email_ok: true,
              email: true,
            },
          },
          vehicle: { select: { make: true, model: true } },
        },
      });

      const openParts = await this.loadOpenReservations(
        tx,
        tenantId,
        parsed.workshop_order_id,
        expectedSiteId,
      );

      const readyEmailPreview = await this.buildReadyEmailPreview(
        tx,
        tenantId,
        expectedSiteId,
        order,
        parsed.notify_customer,
      );

      const warnings = [...plan.warnings];
      if (openParts.length > 0) {
        warnings.push(
          `${openParts.length} parts reservation slice(s) on this order are still open.`,
        );
      }

      return {
        id: order.id,
        entityId: order.id,
        workshop_order_id: order.id,
        site_id: expectedSiteId,
        order_status: {
          previous: plan.orderStatusBefore,
          new: order.status,
        },
        tasks: taskTransitions,
        open_parts_reservations: openParts,
        warnings,
        ready_email: readyEmailPreview,
      };
    });

    if (queuedOutboxId && !DryRunStorage.isDryRun()) {
      await wakeUpAfterCommit(this.wakeUps, queuedOutboxId, tenantId);
    }

    return completion;
  }

  private async planCompletion(
    parsed: ProposeWorkshopOrderCompletionInput,
    tenantId: string,
    siteId: string,
  ) {
    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        id: parsed.workshop_order_id,
        tenant_id: tenantId,
        site_id: siteId,
      },
      include: {
        tasks: { select: { id: true, status: true } },
        invoice: { select: { id: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${parsed.workshop_order_id} not found`,
      );
    }
    assertOrderEditable(order);

    const tasksById = new Map(order.tasks.map((task) => [task.id, task]));
    const openTasks = order.tasks.filter(
      (task) => task.status !== WorkshopTaskStatus.DONE,
    );
    const requestedIds = parsed.workshop_task_ids;
    let taskIdsToComplete: string[];
    if (requestedIds) {
      const unique = new Set(requestedIds);
      if (unique.size !== requestedIds.length) {
        throw new UnprocessableEntityException(
          'Duplicate workshop_task_id in workshop_task_ids',
        );
      }
      for (const taskId of requestedIds) {
        const task = tasksById.get(taskId);
        if (!task) {
          throw new NotFoundException(
            `Task ${taskId} not found for this order`,
          );
        }
        if (task.status === WorkshopTaskStatus.DONE) {
          throw new ConflictException(
            `Task ${taskId} is already completed`,
          );
        }
      }
      taskIdsToComplete = requestedIds;
    } else {
      taskIdsToComplete = openTasks.map((task) => task.id);
    }

    if (taskIdsToComplete.length === 0) {
      throw new UnprocessableEntityException(
        'No open workshop tasks to complete on this order',
      );
    }

    const warnings: string[] = [];
    const remainingOpenAfter = openTasks.filter(
      (task) =>
        !taskIdsToComplete.includes(task.id) &&
        task.status !== WorkshopTaskStatus.DONE,
    );
    if (remainingOpenAfter.length > 0) {
      warnings.push(
        `${remainingOpenAfter.length} workshop task(s) will stay open after this action.`,
      );
    }

    const simulatedStatuses = order.tasks.map((task) =>
      taskIdsToComplete.includes(task.id)
        ? WorkshopTaskStatus.DONE
        : task.status,
    );
    const derivedNext = deriveOrderStatus(simulatedStatuses);
    if (
      derivedNext === order.status &&
      taskIdsToComplete.every(
        (id) => tasksById.get(id)?.status === WorkshopTaskStatus.DONE,
      )
    ) {
      throw new ConflictException(
        'Selected workshop tasks are already completed and the order status would not change.',
      );
    }

    return {
      orderStatusBefore: order.status,
      taskIdsToComplete,
      tasksById,
      warnings,
      derivedNext,
    };
  }

  private async loadOpenReservations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    siteId: string,
  ): Promise<WorkshopOrderCompletionOpenReservation[]> {
    const rows = await tx.partsReservation.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: OPEN_RESERVATION_STATUSES },
        workshop_task_line_item: {
          workshop_task: {
            workshop_order_id: orderId,
            workshop_order: { site_id: siteId },
          },
        },
      },
      select: {
        id: true,
        status: true,
        workshop_task_line_item_id: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    return rows.map((row) => ({
      reservation_id: row.id,
      status: row.status,
      workshop_task_line_item_id: row.workshop_task_line_item_id,
    }));
  }

  private async buildReadyEmailPreview(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    order: {
      status: WorkshopOrderStatus;
      purpose: string;
      customer: {
        id: string;
        contact_email_ok: boolean;
        email: string | null;
      } | null;
      vehicle: { make: string; model: string };
    },
    notifyCustomer: boolean,
  ): Promise<WorkshopOrderCompletionReadyEmailPreview> {
    if (!notifyCustomer) {
      return {
        notify_customer: false,
        will_send: false,
        notice_code: null,
      };
    }
    if (order.status !== WorkshopOrderStatus.COMPLETED) {
      return {
        notify_customer: true,
        will_send: false,
        notice_code: null,
      };
    }
    const site = await tx.site.findFirst({
      where: { id: siteId, tenant_id: tenantId },
      select: { legal_entity: true },
    });
    const sellerReady = site
      ? computeSellerReadiness(site.legal_entity).isReady
      : false;
    const notice = resolveReadyEmailNotice({
      orderStatus: 'COMPLETED',
      purpose: order.purpose,
      customer: order.customer,
      vehicle: order.vehicle,
      sellerName: site?.legal_entity.name ?? '',
      sellerReady,
      latestReadyEmailStatus: null,
    });
    const willSend = notice?.code === 'QUEUED';
    return {
      notify_customer: true,
      will_send: willSend,
      notice_code: notice?.code ?? null,
    };
  }
}
