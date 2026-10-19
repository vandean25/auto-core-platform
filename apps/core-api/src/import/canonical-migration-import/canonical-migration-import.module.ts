import { Module } from '@nestjs/common';
import { CanonicalMigrationBundleService } from './canonical-migration-bundle.service.js';
import { CanonicalMigrationImportController } from './canonical-migration-import.controller.js';

@Module({
  controllers: [CanonicalMigrationImportController],
  providers: [CanonicalMigrationBundleService],
})
export class CanonicalMigrationImportModule {}
