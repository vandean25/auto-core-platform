import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import type { RegisterIntakeDto } from './dto/register-intake.dto.js';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { DomainEventStoreService } from '../domain-event-store/domain-event-store.service.js';
import { normalizeWorkshopOrder } from './workshop-order.helpers.js';
import { computeWorkshopLaborSummary } from './workshop-labor-summary.helpers.js';
import { WorkshopScheduleService } from './workshop-schedule.service.js';
import { WorkshopOrderReadyEmailService } from './workshop-order-ready-email.service.js';
import { WorkshopPositionPlanService } from './workshop-position-plan.service.js';
import {
  executeCreateWorkshopOrder,
  executeFindAllWorkshopOrders,
  executeFindOneWorkshopOrder,
  executeRegisterIntake,
  executeSearchWorkshop,
  executeUpdateOrder,
  generateNextWorkshopOrderNumber,
  type WorkshopIntakeServices,
} from './workshop-intake.helpers.js';

@Injectable()
export class WorkshopIntakeService {
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly siteContext: SiteContextService;
  private readonly scheduleService: WorkshopScheduleService;
  private readonly partsRequisitionService: PartsRequisitionService;
  private readonly domainEventStore: DomainEventStoreService;
  private readonly requestContext: RequestContextService;
  private readonly readyEmail: WorkshopOrderReadyEmailService;
  private readonly positionPlan: WorkshopPositionPlanService;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(TenantContextService) tenantContext: TenantContextService,
    @Inject(SiteContextService) siteContext: SiteContextService,
    scheduleService: WorkshopScheduleService,
    partsRequisitionService: PartsRequisitionService,
    domainEventStore: DomainEventStoreService,
    requestContext: RequestContextService,
    readyEmail: WorkshopOrderReadyEmailService,
    positionPlan: WorkshopPositionPlanService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.scheduleService = scheduleService;
    this.partsRequisitionService = partsRequisitionService;
    this.domainEventStore = domainEventStore;
    this.requestContext = requestContext;
    this.readyEmail = readyEmail;
    this.positionPlan = positionPlan;
  }

  private getServices(): WorkshopIntakeServices {
    return {
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
      scheduleService: this.scheduleService,
      partsRequisitionService: this.partsRequisitionService,
      domainEventStore: this.domainEventStore,
      requestContext: this.requestContext,
      positionPlan: this.positionPlan,
    };
  }

  private async generateOrderNumber(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const services = this.getServices();
    const tenantId = await services.tenantContext.getTenantId();
    return generateNextWorkshopOrderNumber(tx ?? services.prisma, tenantId);
  }

  async register(dto: RegisterIntakeDto) {
    const services = this.getServices();
    const tenantId = await services.tenantContext.getTenantId();
    return executeRegisterIntake(services.prisma, tenantId, dto);
  }

  async create(dto: CreateWorkshopOrderDto) {
    const order = await executeCreateWorkshopOrder(
      this.getServices(),
      dto,
      (tx) => this.generateOrderNumber(tx),
    );
    return normalizeWorkshopOrder(order);
  }

  async createAtSite(dto: CreateWorkshopOrderDto, siteId: string) {
    const order = await executeCreateWorkshopOrder(
      this.getServices(),
      dto,
      (tx) => this.generateOrderNumber(tx),
      siteId,
    );
    return normalizeWorkshopOrder(order);
  }

  async findAll(params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
    customerId?: string;
  }) {
    const services = this.getServices();
    const tenantId = await services.tenantContext.getTenantId();
    const siteId = await services.siteContext.getSiteId();
    return executeFindAllWorkshopOrders(
      services.prisma,
      tenantId,
      siteId,
      params,
    );
  }

  async findOne(id: string) {
    const services = this.getServices();
    const tenantId = await services.tenantContext.getTenantId();
    const siteId = await services.siteContext.getSiteId();
    const order = await executeFindOneWorkshopOrder(
      services.prisma,
      tenantId,
      siteId,
      id,
    );
    const ready_email_notice = await this.readyEmail.loadNoticeForOrder(
      tenantId,
      siteId,
      id,
    );
    return {
      ...order,
      labor_summary: computeWorkshopLaborSummary(order.tasks),
      ready_email_notice,
    };
  }

  async updateOrder(id: string, dto: UpdateWorkshopOrderDto) {
    const updated = await executeUpdateOrder(this.getServices(), id, dto);
    return normalizeWorkshopOrder(updated);
  }

  async search(query: string) {
    const services = this.getServices();
    const tenantId = await services.tenantContext.getTenantId();
    return executeSearchWorkshop(services.prisma, tenantId, query);
  }
}
