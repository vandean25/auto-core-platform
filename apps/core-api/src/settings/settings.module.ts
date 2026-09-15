import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CatalogProviderSettingsController } from './catalog-provider-settings.controller.js';
import { CatalogProviderSettingsService } from './catalog-provider-settings.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogProviderSettingsController],
  providers: [CatalogProviderSettingsService],
})
export class SettingsModule {}
