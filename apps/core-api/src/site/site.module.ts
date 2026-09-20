import { Global, Module } from '@nestjs/common';
import { AccountingProfileService } from '../finance/accounting-profile/accounting-profile.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LegalEntityService } from './legal-entity.service.js';
import {
  LegalEntityController,
  MeSiteController,
  SiteController,
} from './site.controller.js';
import { SiteContextService } from './site-context.service.js';
import { SiteMembershipService } from './site-membership.service.js';
import { SiteService } from './site.service.js';

/**
 * Global module so BayService / LocationService / WorkshopSettingsService can
 * resolve the tenant's default (MAIN) site before SiteContext exists, and so
 * the realtime gateway can resolve the session's active site room.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LegalEntityController, SiteController, MeSiteController],
  providers: [
    SiteService,
    SiteContextService,
    LegalEntityService,
    AccountingProfileService,
    SiteMembershipService,
  ],
  exports: [
    SiteService,
    SiteContextService,
    LegalEntityService,
    AccountingProfileService,
    SiteMembershipService,
  ],
})
export class SiteModule {}
