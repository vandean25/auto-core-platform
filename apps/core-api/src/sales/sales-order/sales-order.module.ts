import { Module } from '@nestjs/common';
import { SalesOrderService } from './sales-order.service.js';
import { SalesOrderController } from './sales-order.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { FinanceModule } from '../../finance/finance.module.js';

@Module({
  imports: [PrismaModule, FinanceModule],
  controllers: [SalesOrderController],
  providers: [SalesOrderService],
  exports: [SalesOrderService],
})
export class SalesOrderModule {}
