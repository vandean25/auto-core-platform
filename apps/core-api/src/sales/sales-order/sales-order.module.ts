import { Module } from '@nestjs/common';
import { ScopeContextModule } from '../../auth/scope-context/scope-context.module.js';
import { SalesOrderService } from './sales-order.service.js';
import { SalesOrderListService } from './sales-order-list.service.js';
import { SalesOrderController } from './sales-order.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { FinanceModule } from '../../finance/finance.module.js';

@Module({
  imports: [PrismaModule, FinanceModule, ScopeContextModule],
  controllers: [SalesOrderController],
  providers: [SalesOrderService, SalesOrderListService],
  exports: [SalesOrderService],
})
export class SalesOrderModule {}
