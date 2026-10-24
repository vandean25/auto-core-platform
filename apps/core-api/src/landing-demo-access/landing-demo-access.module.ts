import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { LandingDemoAccessController } from './landing-demo-access.controller.js';
import { LandingDemoAccessService } from './landing-demo-access.service.js';
import { PublicRateLimitStore } from './public-rate-limit.store.js';
import { TurnstileVerifier } from './turnstile.verifier.js';
import { LandingDemoAccessCleanupService } from './landing-demo-access.cleanup.service.js';
import { LandingDemoSignInGrantModule } from './landing-demo-sign-in-grant.module.js';

@Module({
  imports: [PrismaModule, NotificationsModule, LandingDemoSignInGrantModule],
  controllers: [LandingDemoAccessController],
  providers: [
    LandingDemoAccessService,
    PublicRateLimitStore,
    TurnstileVerifier,
    LandingDemoAccessCleanupService,
  ],
  exports: [LandingDemoAccessService],
})
export class LandingDemoAccessModule {}
