import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CustomerActivityService } from './activity/customer-activity.service.js';
import { CustomerController } from './customer.controller.js';
import { CustomerNotesController } from './notes/customer-notes.controller.js';
import { CustomerNotesService } from './notes/customer-notes.service.js';
import { CustomerNoteRetentionService } from './notes/customer-note-retention.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module.js';

@Module({
  imports: [PrismaModule, AuditModule, CustomFieldsModule],
  controllers: [CustomerController, CustomerNotesController],
  providers: [
    CustomerService,
    CustomerActivityService,
    CustomerNotesService,
    CustomerNoteRetentionService,
  ],
  exports: [
    CustomerService,
    CustomerActivityService,
    CustomerNotesService,
    CustomerNoteRetentionService,
  ],
})
export class CustomerModule {}
