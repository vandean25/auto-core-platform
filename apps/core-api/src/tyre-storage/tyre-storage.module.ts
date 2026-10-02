import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { TyreStorageController } from './tyre-storage.controller.js';
import { TyreStorageClock } from './tyre-storage.clock.js';
import { TyreStorageService } from './tyre-storage.service.js';

@Module({
  imports: [PrismaModule, CommonModule, SiteModule],
  controllers: [TyreStorageController],
  providers: [TyreStorageService, TyreStorageClock],
  exports: [TyreStorageService, TyreStorageClock],
})
export class TyreStorageModule {}
