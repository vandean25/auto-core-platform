import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CommonModule } from '../common/index.js';
import { DocumentBrandingModule } from '../document-branding/document-branding.module.js';
import { Autoscout24DmsModule } from '../vehicle/listing-export/autoscout24-dms.module.js';
import { KaufvertragPdfRenderer } from './kaufvertrag/kaufvertrag-pdf.renderer.js';
import { VehicleSaleKaufvertragPdfService } from './kaufvertrag/kaufvertrag-pdf.service.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { VehiclePurchaseService } from './vehicle-purchase.service.js';
import { VehiclePurchaseController } from './vehicle-purchase.controller.js';
import { VehicleSaleService } from './vehicle-sale.service.js';
import { VehicleSaleController } from './vehicle-sale.controller.js';
import { VehicleSaleTradeInService } from './vehicle-sale-trade-in.service.js';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';
import { VehicleStockController } from './vehicle-stock.controller.js';
import { VehicleStockMoveService } from './vehicle-stock-move.service.js';
import { VehicleStockReportsService } from './vehicle-stock-reports.service.js';
import {
  GcsVehicleMediaStorage,
  VEHICLE_MEDIA_STORAGE,
} from './vehicle-media/vehicle-media.storage.js';
import { VehicleMediaService } from './vehicle-media/vehicle-media.service.js';
import { VehicleMediaController } from './vehicle-media/vehicle-media.controller.js';
import {
  getVehicleMediaPurgeStorage,
  registerVehicleMediaPurgeStorage,
} from './vehicle-media/vehicle-media-purge.registry.js';

@Module({
  imports: [
    PrismaModule,
    InvoicesModule,
    AuditModule,
    CommonModule,
    DocumentBrandingModule,
    Autoscout24DmsModule,
  ],
  controllers: [
    VehiclePurchaseController,
    VehicleSaleController,
    VehicleStockController,
    VehicleMediaController,
  ],
  providers: [
    VehicleLedgerService,
    VehiclePurchaseService,
    VehicleSaleService,
    VehicleSaleTradeInService,
    KaufvertragPdfRenderer,
    VehicleSaleKaufvertragPdfService,
    VehicleStockQueryService,
    VehicleStockMoveService,
    VehicleStockReportsService,
    GcsVehicleMediaStorage,
    { provide: VEHICLE_MEDIA_STORAGE, useExisting: GcsVehicleMediaStorage },
    VehicleMediaService,
  ],
  exports: [
    VehicleLedgerService,
    VehicleSaleService,
    VehicleStockQueryService,
    VehicleStockReportsService,
    VEHICLE_MEDIA_STORAGE,
  ],
})
export class VehicleStockModule implements OnModuleInit {
  constructor(private readonly vehicleMediaStorage: GcsVehicleMediaStorage) {}

  onModuleInit(): void {
    if (!getVehicleMediaPurgeStorage()) {
      registerVehicleMediaPurgeStorage(this.vehicleMediaStorage);
    }
  }
}
