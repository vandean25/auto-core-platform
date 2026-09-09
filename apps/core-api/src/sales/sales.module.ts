import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceFinalizationService } from './invoice-finalization.service';

@Module({
  imports: [PrismaModule],
  controllers: [SalesController],
  providers: [SalesService, InvoiceFinalizationService],
})
export class SalesModule {}
