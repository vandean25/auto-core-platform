import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { AtpService } from '../inventory/atp.service.js';
import { LedgerService } from '../inventory/ledger.service.js';
import type { PurchaseOrderWithRelations } from '../purchase/purchase.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePartsRequisitionDto } from './dto/create-parts-requisition.dto.js';
import type { CreatePartsReservationDto } from './dto/create-parts-reservation.dto.js';
import type { CreateRequisitionPurchaseOrderDto } from './dto/create-requisition-purchase-order.dto.js';
import type { ConsumePartsReservationDto } from './dto/consume-parts-reservation.dto.js';
import type { ReleasePartsReservationDto } from './dto/release-parts-reservation.dto.js';
import type { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto.js';
import type { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import type { PartsShortageResponseDto } from './dto/parts-shortage-response.dto.js';
import type { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto.js';
import {
  assertBackOfficeAccess,
  assertUniqueSelections,
  executeConsumeReservation,
  executeCreateOnHandReservation,
  executeCreatePurchaseOrderForRequisition,
  executeCreateRequisitionSheet,
  executeReleaseReservation,
  fetchShortages,
} from './parts-requisition-lifecycle.helpers.js';

export type PartsRequisitionServiceDeps = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  atpService: AtpService;
  ledgerService: LedgerService;
  logger: Logger;
};

async function runAuthorized<T>(
  deps: PartsRequisitionServiceDeps,
  handler: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
  ) => Promise<T>,
): Promise<T> {
  assertBackOfficeAccess(deps.tenantContext);
  const tenantId = await deps.tenantContext.getTenantId();
  const siteId = await deps.siteContext.getSiteId();
  return deps.prisma.$transaction((tx) => handler(tx, tenantId, siteId));
}

function createOnHandReservationCommand(
  deps: PartsRequisitionServiceDeps,
  dto: CreatePartsReservationDto,
): Promise<PartsReservationResponseDto> {
  deps.logger.debug(
    `Creating on-hand reservation for line ${dto.workshopTaskLineItemId}`,
  );
  return runAuthorized(deps, (tx, tenantId, siteId) =>
    executeCreateOnHandReservation(tx, tenantId, siteId, dto, deps.atpService),
  );
}

function queryPartsShortagesCommand(
  deps: PartsRequisitionServiceDeps,
  query: PartsShortagesQueryDto,
): Promise<{
  data: PartsShortageResponseDto[];
  meta: Record<string, number>;
}> {
  deps.logger.debug(
    `Querying part shortages for order ${query.workshopOrderId ?? 'all'}`,
  );
  return runAuthorized(deps, (tx, tenantId, siteId) =>
    fetchShortages(tx, tenantId, siteId, query),
  );
}

function consumePartsReservationCommand(
  deps: PartsRequisitionServiceDeps,
  reservationId: string,
  dto: ConsumePartsReservationDto,
): Promise<PartsReservationResponseDto> {
  deps.logger.debug(
    `Consuming reservation ${reservationId} quantity ${dto.quantity}`,
  );
  return runAuthorized(deps, (tx, tenantId, siteId) =>
    executeConsumeReservation(
      tx,
      tenantId,
      siteId,
      reservationId,
      dto,
      deps.ledgerService,
    ),
  );
}

async function releasePartsReservationCommand(
  deps: PartsRequisitionServiceDeps,
  reservationId: string,
  dto: ReleasePartsReservationDto,
  transaction?: Prisma.TransactionClient,
): Promise<PartsReservationResponseDto> {
  deps.logger.debug(`Releasing reservation ${reservationId}`);
  const execute = (
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
  ) =>
    executeReleaseReservation(
      tx,
      tenantId,
      siteId,
      reservationId,
      dto,
      deps.atpService,
      deps.ledgerService,
    );

  if (transaction) {
    assertBackOfficeAccess(deps.tenantContext);
    const tenantId = await deps.tenantContext.getTenantId();
    const siteId = await deps.siteContext.getSiteId();
    return execute(transaction, tenantId, siteId);
  }

  return runAuthorized(deps, execute);
}

function createPartsRequisitionSheetCommand(
  deps: PartsRequisitionServiceDeps,
  dto: CreatePartsRequisitionDto,
): Promise<PartsRequisitionResponseDto> {
  deps.logger.debug(
    `Creating requisition sheet for brand ${dto.vehicleMakeBrandId} with ${dto.items.length} items`,
  );
  assertUniqueSelections(dto.items.map((item) => item.workshopTaskLineItemId));
  return runAuthorized(deps, (tx, tenantId, siteId) =>
    executeCreateRequisitionSheet(tx, tenantId, siteId, dto),
  );
}

function createPurchaseOrderFromRequisitionCommand(
  deps: PartsRequisitionServiceDeps,
  requisitionId: string,
  dto: CreateRequisitionPurchaseOrderDto,
): Promise<PurchaseOrderWithRelations> {
  deps.logger.debug(
    `Creating PO from requisition ${requisitionId} for vendor ${dto.vendorId}`,
  );
  assertUniqueSelections(dto.items.map((item) => item.reservationId));
  return runAuthorized(deps, (tx, tenantId, siteId) =>
    executeCreatePurchaseOrderForRequisition(
      tx,
      tenantId,
      siteId,
      requisitionId,
      dto,
    ),
  );
}

@Injectable()
export class PartsRequisitionService {
  private readonly logger = new Logger(PartsRequisitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly atpService: AtpService,
    private readonly ledgerService: LedgerService,
  ) {}

  createOnHandReservation(dto: CreatePartsReservationDto) {
    return createOnHandReservationCommand(this.deps(), dto);
  }

  getShortages(query: PartsShortagesQueryDto) {
    return queryPartsShortagesCommand(this.deps(), query);
  }

  consumeReservation(
    reservationId: string,
    dto: ConsumePartsReservationDto,
  ): Promise<PartsReservationResponseDto> {
    return consumePartsReservationCommand(this.deps(), reservationId, dto);
  }

  releaseReservation(
    reservationId: string,
    dto: ReleasePartsReservationDto,
    transaction?: Prisma.TransactionClient,
  ): Promise<PartsReservationResponseDto> {
    return releasePartsReservationCommand(
      this.deps(),
      reservationId,
      dto,
      transaction,
    );
  }

  createRequisitionSheet(
    dto: CreatePartsRequisitionDto,
  ): Promise<PartsRequisitionResponseDto> {
    return createPartsRequisitionSheetCommand(this.deps(), dto);
  }

  createPurchaseOrderForRequisition(
    requisitionId: string,
    dto: CreateRequisitionPurchaseOrderDto,
  ): Promise<PurchaseOrderWithRelations> {
    return createPurchaseOrderFromRequisitionCommand(
      this.deps(),
      requisitionId,
      dto,
    );
  }

  private deps(): PartsRequisitionServiceDeps {
    return {
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
      atpService: this.atpService,
      ledgerService: this.ledgerService,
      logger: this.logger,
    };
  }
}
