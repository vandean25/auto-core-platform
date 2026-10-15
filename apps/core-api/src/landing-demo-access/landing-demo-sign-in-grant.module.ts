import { Module } from '@nestjs/common';
import { LandingDemoSignInGrantService } from './landing-demo-sign-in-grant.service.js';

@Module({
  providers: [LandingDemoSignInGrantService],
  exports: [LandingDemoSignInGrantService],
})
export class LandingDemoSignInGrantModule {}
