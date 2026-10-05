import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DryRunService } from './dry-run.service.js';
import { DryRunInterceptor } from './dry-run.interceptor.js';

@Module({
  providers: [
    DryRunService,
    DryRunInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: DryRunInterceptor,
    },
  ],
  exports: [DryRunService, DryRunInterceptor],
})
export class DryRunModule {}
