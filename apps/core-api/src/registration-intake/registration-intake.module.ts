import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommonModule } from '../common/common.module.js';
import { RegistrationIntakeController } from './registration-intake.controller.js';
import { RegistrationIntakeService } from './registration-intake.service.js';
import { RegistrationIntakeApplyService } from './registration-intake-apply.service.js';
import { RegistrationIntakeMatchService } from './registration-intake-match.service.js';
import { RegistrationIntakeBytePurgeService } from './registration-intake-byte-purge.service.js';
import { RegistrationIntakeExpiryService } from './registration-intake-expiry.service.js';
import { REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER } from './registration-document-extraction-provider.js';
import { createRegistrationDocumentExtractionProvider } from './registration-document-extraction-provider.factory.js';
import {
  GcsRegistrationIntakeByteStorage,
  REGISTRATION_INTAKE_BYTE_STORAGE,
} from './registration-intake-byte-storage.js';
import { WorkshopModule } from '../workshop/workshop.module.js';

@Module({
  imports: [PrismaModule, CommonModule, forwardRef(() => WorkshopModule)],
  controllers: [RegistrationIntakeController],
  providers: [
    RegistrationIntakeService,
    RegistrationIntakeApplyService,
    RegistrationIntakeMatchService,
    RegistrationIntakeBytePurgeService,
    RegistrationIntakeExpiryService,
    {
      provide: REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER,
      useFactory: () => createRegistrationDocumentExtractionProvider(),
    },
    {
      provide: REGISTRATION_INTAKE_BYTE_STORAGE,
      useClass: GcsRegistrationIntakeByteStorage,
    },
  ],
  exports: [RegistrationIntakeService, RegistrationIntakeApplyService],
})
export class RegistrationIntakeModule {}
