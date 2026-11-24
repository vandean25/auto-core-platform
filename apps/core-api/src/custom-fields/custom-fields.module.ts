import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CustomFieldsEnabledGuard } from './custom-fields-enabled.guard.js';
import { CustomFieldsGdprService } from './custom-fields-gdpr.service.js';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CustomFieldsController],
  providers: [
    CustomFieldsService,
    CustomFieldsGdprService,
    CustomFieldsEnabledGuard,
  ],
  exports: [CustomFieldsService, CustomFieldsGdprService],
})
export class CustomFieldsModule {}
