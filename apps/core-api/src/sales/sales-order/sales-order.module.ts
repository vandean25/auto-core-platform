import { Module } from '@nestjs/common';
import { SalesOrderService } from './sales-order.service';
import { SalesOrderController } from './sales-order.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { FinanceModule } from '../../finance/finance.module';

@Module({
  imports: [PrismaModule, FinanceModule],
  controllers: [SalesOrderController],
  providers: [SalesOrderService],
  exports: [SalesOrderService]
})
export class SalesOrderModule {}
