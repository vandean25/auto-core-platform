import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { CommonModule } from '../common/index.js';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';
import { SettlementService } from './settlement.service.js';
import {
  SettlementController,
  FiscalReceiptsController,
} from './settlement.controller.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import type { FiskalySignAtProvider } from './fiskaly-sign-at.types.js';
import { FISKALY_SIGN_AT_PROVIDER } from './fiskaly-sign-at.types.js';
import { FiskalySignAtHttpAdapter } from './fiskaly-sign-at-http.adapter.js';
import { isFiskalySignAtLiveEnabled } from './settlement.constants.js';

export function selectFiskalySignAtProvider(
  fixture: FiskalySignAtProvider,
  http: FiskalySignAtProvider,
): FiskalySignAtProvider {
  if (isFiskalySignAtLiveEnabled()) {
    return http;
  }
  return process.env.NODE_ENV === 'test' ? fixture : http;
}

@Module({
  imports: [PrismaModule, SiteModule, CommonModule, DashboardRealtimeModule],
  controllers: [SettlementController, FiscalReceiptsController],
  providers: [
    SettlementService,
    FiskalySignAtFixtureProvider,
    {
      provide: FiskalySignAtHttpAdapter,
      useFactory: () => new FiskalySignAtHttpAdapter(null, false),
    },
    {
      provide: FISKALY_SIGN_AT_PROVIDER,
      useFactory: (
        fixture: FiskalySignAtFixtureProvider,
        http: FiskalySignAtHttpAdapter,
      ) => selectFiskalySignAtProvider(fixture, http),
      inject: [FiskalySignAtFixtureProvider, FiskalySignAtHttpAdapter],
    },
  ],
  exports: [SettlementService, FiskalySignAtFixtureProvider],
})
export class SettlementModule {}
