import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogProviderSettingsController } from './catalog-provider-settings.controller';
import { CatalogProviderSettingsService } from './catalog-provider-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogProviderSettingsController],
  providers: [CatalogProviderSettingsService],
})
export class SettingsModule {}
