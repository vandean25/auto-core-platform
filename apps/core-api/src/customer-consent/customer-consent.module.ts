import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { CustomerConsentController } from './customer-consent.controller.js';
import { CustomerConsentRetentionService } from './customer-consent-retention.service.js';
import { CustomerConsentService } from './customer-consent.service.js';
import { PublicCustomerConsentUnsubscribeController } from './public-customer-consent-unsubscribe.controller.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [
    CustomerConsentController,
    PublicCustomerConsentUnsubscribeController,
  ],
  providers: [
    CustomerConsentService,
    CustomerConsentRetentionService,
    SystemPrismaService,
  ],
  exports: [CustomerConsentService, CustomerConsentRetentionService],
})
export class CustomerConsentModule {}
