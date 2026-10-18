import { Injectable } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { LedgerService } from '../inventory/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ApproveStockTransferDto,
  CancelStockTransferDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
  RejectStockTransferDto,
  ReturnStockTransferDto,
  ShipStockTransferDto,
} from './dto/stock-transfer.dto.js';
import { SerializedStockTransfer } from './stock-transfer-serializer.js';
import { wireStockTransferServiceForUnitTest } from './stock-transfer-service.test-wiring.js';
import { StockTransferMutationService } from './stock-transfer-mutation.service.js';
import { StockTransferQueryService } from './stock-transfer-query.service.js';

@Injectable()
export class StockTransferService {
  constructor(
    private readonly queryService: StockTransferQueryService,
    private readonly mutationService: StockTransferMutationService,
  ) {}

  /** Unit tests only — mirrors the pre-split four-dependency constructor. */
  static forUnitTest(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    ledgerService: LedgerService,
    realtimeService: DashboardRealtimeService,
  ): StockTransferService {
    const wired = wireStockTransferServiceForUnitTest(
      prisma,
      tenantContext,
      ledgerService,
      realtimeService,
    );
    return new StockTransferService(
      wired.queryService,
      wired.mutationService,
    );
  }

  list(): Promise<SerializedStockTransfer[]> {
    return this.queryService.list();
  }

  detail(id: string): Promise<SerializedStockTransfer> {
    return this.queryService.detail(id);
  }

  create(dto: CreateStockTransferDto): Promise<SerializedStockTransfer> {
    return this.mutationService.create(dto);
  }

  approve(
    id: string,
    dto: ApproveStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    return this.mutationService.approve(id, dto);
  }

  reject(
    id: string,
    dto: RejectStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    return this.mutationService.reject(id, dto);
  }

  cancel(
    id: string,
    dto: CancelStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    return this.mutationService.cancel(id, dto);
  }

  ship(
    id: string,
    dto: ShipStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    return this.mutationService.ship(id, dto);
  }

  receive(
    id: string,
    dto: ReceiveStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    return this.mutationService.receive(id, dto);
  }

  returnTransfer(
    id: string,
    dto: ReturnStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    return this.mutationService.returnTransfer(id, dto);
  }
}
