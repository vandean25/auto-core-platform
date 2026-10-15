import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { CommonModule } from '../common/index.js';
import { SettlementService } from './settlement.service.js';
import {
  SettlementController,
  FiscalReceiptsController,
} from './settlement.controller.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import { FISKALY_SIGN_AT_PROVIDER } from './fiskaly-sign-at.types.js';
import { FiskalySignAtHttpAdapter } from './fiskaly-sign-at-http.adapter.js';
import { isFiskalySignAtLiveEnabled } from './settlement.constants.js';

@Module({
  imports: [PrismaModule, SiteModule, CommonModule],
  controllers: [SettlementController, FiscalReceiptsController],
  providers: [
    SettlementService,
    FiskalySignAtFixtureProvider,
    {
      provide: FiskalySignAtHttpAdapter,
      useFactory: () => new FiskalySignAtHttpAdapter(null),
    },
    {
      provide: FISKALY_SIGN_AT_PROVIDER,
      useFactory: (
        fixture: FiskalySignAtFixtureProvider,
        http: FiskalySignAtHttpAdapter,
      ) => (isFiskalySignAtLiveEnabled() ? http : fixture),
      inject: [FiskalySignAtFixtureProvider, FiskalySignAtHttpAdapter],
    },
  ],
  exports: [SettlementService, FiskalySignAtFixtureProvider],
})
export class SettlementModule {}
