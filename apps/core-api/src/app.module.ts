import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';

import { PurchaseModule } from './purchase/purchase.module';
import { VendorModule } from './vendor/vendor.module';

@Module({
  imports: [PrismaModule, InventoryModule, PurchaseModule, VendorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
