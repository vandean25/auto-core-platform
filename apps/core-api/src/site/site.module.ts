import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LegalEntityService } from './legal-entity.service';
import { LegalEntityController, SiteController } from './site.controller';
import { SiteMembershipService } from './site-membership.service';
import { SiteService } from './site.service';

/**
 * Global module so BayService / LocationService / WorkshopSettingsService can
 * resolve the tenant's default (MAIN) site before SiteContext exists.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LegalEntityController, SiteController],
  providers: [SiteService, LegalEntityService, SiteMembershipService],
  exports: [SiteService, LegalEntityService, SiteMembershipService],
})
export class SiteModule {}
