import { Module } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';
import { ImportMappingProfileService } from './import-mapping-profile.service.js';

@Module({
  controllers: [ImportController],
  providers: [ImportService, ImportMappingProfileService],
})
export class ImportModule {}
