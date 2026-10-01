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

/**
 * Service coordinating parts requisitions, reservations, and inventory integration.
 * Business rules and database operations are delegated to lifecycle helpers.
 */
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

  private async runAuthorized<T>(
    handler: (
      tx: Prisma.TransactionClient,
      tenantId: string,
      siteId: string,
    ) => Promise<T>,
  ): Promise<T> {
    assertBackOfficeAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return this.prisma.$transaction((tx) => handler(tx, tenantId, siteId));
  }

  /**
   * Reserves on-hand inventory stock for an authorized workshop line item.
   */
  async createOnHandReservation(
    dto: CreatePartsReservationDto,
  ): Promise<PartsReservationResponseDto> {
    this.logger.debug(
      `Creating on-hand reservation for line ${dto.workshopTaskLineItemId}`,
    );
    const atp = this.atpService;
    return this.runAuthorized((tx, tenantId, siteId) =>
      executeCreateOnHandReservation(tx, tenantId, siteId, dto, atp),
    );
  }

  /**
   * Retrieves uncommitted part shortages across authorized workshop orders.
   */
  async getShortages(query: PartsShortagesQueryDto): Promise<{
    data: PartsShortageResponseDto[];
    meta: Record<string, number>;
  }> {
    this.logger.debug(
      `Querying part shortages for order ${query.workshopOrderId ?? 'all'}`,
    );
    assertBackOfficeAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return fetchShortages(this.prisma, tenantId, siteId, query);
  }

  /**
   * Consumes staged parts reservation quantity into the job tote.
   */
  async consumeReservation(
    reservationId: string,
    dto: ConsumePartsReservationDto,
  ): Promise<PartsReservationResponseDto> {
    this.logger.debug(
      `Consuming reservation ${reservationId} quantity ${dto.quantity}`,
    );
    const ledger = this.ledgerService;
    return this.runAuthorized((tx, tenantId, siteId) =>
      executeConsumeReservation(
        tx,
        tenantId,
        siteId,
        reservationId,
        dto,
        ledger,
      ),
    );
  }

  /**
   * Releases an active or staged parts reservation back to inventory.
   */
  async releaseReservation(
    reservationId: string,
    dto: ReleasePartsReservationDto,
    transaction?: Prisma.TransactionClient,
  ): Promise<PartsReservationResponseDto> {
    this.logger.debug(`Releasing reservation ${reservationId}`);
    const atp = this.atpService;
    const ledger = this.ledgerService;

    if (transaction) {
      assertBackOfficeAccess(this.tenantContext);
      const tenantId = await this.tenantContext.getTenantId();
      const siteId = await this.siteContext.getSiteId();
      return executeReleaseReservation(
        transaction,
        tenantId,
        siteId,
        reservationId,
        dto,
        atp,
        ledger,
      );
    }

    return this.runAuthorized((tx, tenantId, siteId) =>
      executeReleaseReservation(
        tx,
        tenantId,
        siteId,
        reservationId,
        dto,
        atp,
        ledger,
      ),
    );
  }

  /**
   * Creates a new parts requisition sheet grouping demand slices.
   */
  async createRequisitionSheet(
    dto: CreatePartsRequisitionDto,
  ): Promise<PartsRequisitionResponseDto> {
    this.logger.debug(
      `Creating requisition sheet for brand ${dto.vehicleMakeBrandId} with ${dto.items.length} items`,
    );
    assertUniqueSelections(
      dto.items.map((item) => item.workshopTaskLineItemId),
    );
    return this.runAuthorized((tx, tenantId, siteId) =>
      executeCreateRequisitionSheet(tx, tenantId, siteId, dto),
    );
  }

  /**
   * Generates a purchase order from selected requisition reservation slices.
   */
  async createPurchaseOrderForRequisition(
    requisitionId: string,
    dto: CreateRequisitionPurchaseOrderDto,
  ): Promise<PurchaseOrderWithRelations> {
    this.logger.debug(
      `Creating PO from requisition ${requisitionId} for vendor ${dto.vendorId}`,
    );
    assertUniqueSelections(dto.items.map((item) => item.reservationId));
    return this.runAuthorized((tx, tenantId, siteId) =>
      executeCreatePurchaseOrderForRequisition(
        tx,
        tenantId,
        siteId,
        requisitionId,
        dto,
      ),
    );
  }
}
