import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantLocaleController } from './tenant-locale.controller.js';
import { TenantLocaleService } from './tenant-locale.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantLocaleController],
  providers: [TenantLocaleService],
  exports: [TenantLocaleService],
})
export class TenantModule {}
