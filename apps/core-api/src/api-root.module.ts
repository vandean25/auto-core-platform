import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { CanonicalMigrationImportModule } from './import/canonical-migration-import/canonical-migration-import.module.js';

@Module({
  imports: [AppModule, CanonicalMigrationImportModule],
})
export class ApiRootModule {}
