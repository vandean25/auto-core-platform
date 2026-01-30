import { Module } from '@nestjs/common';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerService } from '../inventory/ledger.service';

@Module({
    imports: [InventoryModule, PrismaModule],
    controllers: [PurchaseController],
    providers: [PurchaseService],
})
export class PurchaseModule { }
