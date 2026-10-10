import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CommonModule } from '../common/index.js';
import { DocumentBrandingModule } from '../document-branding/document-branding.module.js';
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

@Module({
  imports: [
    PrismaModule,
    InvoicesModule,
    AuditModule,
    CommonModule,
    DocumentBrandingModule,
  ],
  controllers: [
    VehiclePurchaseController,
    VehicleSaleController,
    VehicleStockController,
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
  ],
  exports: [
    VehicleLedgerService,
    VehicleSaleService,
    VehicleStockReportsService,
  ],
})
export class VehicleStockModule {}
