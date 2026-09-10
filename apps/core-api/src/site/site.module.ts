import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  LegalEntityController,
  MeSiteController,
  SiteController,
} from './site.controller';
import { SiteContextService } from './site-context.service';
import { SiteService } from './site.service';

/**
 * Global module so BayService / LocationService / WorkshopSettingsService can
 * resolve the tenant's default (MAIN) site before SiteContext exists, and so
 * the realtime gateway can resolve the session's active site room.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LegalEntityController, SiteController, MeSiteController],
  providers: [SiteService, SiteContextService],
  exports: [SiteService, SiteContextService],
})
export class SiteModule {}
