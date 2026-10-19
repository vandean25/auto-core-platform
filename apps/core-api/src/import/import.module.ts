import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { importModuleControllers } from './import-module.controllers.js';
import { importModuleProviders } from './import-module.providers.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: importModuleControllers,
  providers: importModuleProviders,
})
export class ImportModule {}
