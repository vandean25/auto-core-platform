import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CanonicalMigrationImportController } from './canonical-migration-import.controller.js';
import { ImportController } from './import.controller.js';
import { ImportMappingProfileService } from './import-mapping-profile.service.js';
import { ImportRetentionService } from './import-retention.service.js';
import { ImportService } from './import.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [ImportController, CanonicalMigrationImportController],
  providers: [
    ImportService,
    ImportMappingProfileService,
    ImportRetentionService,
  ],
})
export class ImportModule {}
