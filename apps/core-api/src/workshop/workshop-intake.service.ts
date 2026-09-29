import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import type { RegisterIntakeDto } from './dto/register-intake.dto.js';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { normalizeWorkshopOrder } from './workshop-order.helpers.js';
import { WorkshopScheduleService } from './workshop-schedule.service.js';
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

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(TenantContextService) tenantContext: TenantContextService,
    @Inject(SiteContextService) siteContext: SiteContextService,
    scheduleService: WorkshopScheduleService,
    partsRequisitionService: PartsRequisitionService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.scheduleService = scheduleService;
    this.partsRequisitionService = partsRequisitionService;
  }

  private getServices(): WorkshopIntakeServices {
    return {
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
      scheduleService: this.scheduleService,
      partsRequisitionService: this.partsRequisitionService,
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

  async findAll(params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
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
    return executeFindOneWorkshopOrder(services.prisma, tenantId, siteId, id);
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
