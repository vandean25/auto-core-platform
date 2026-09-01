import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';

/**
 * Global module so BayService / LocationService / WorkshopSettingsService can
 * resolve the tenant's default (MAIN) site before SiteContext exists.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SiteController],
  providers: [SiteService],
  exports: [SiteService],
})
export class SiteModule {}
