import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import {
  CapabilityGuard,
  EffectiveCapabilitiesService,
} from './effective-capabilities.guard.js';

@Module({
  imports: [AuthModule],
  providers: [CapabilityGuard, EffectiveCapabilitiesService],
  exports: [CapabilityGuard, EffectiveCapabilitiesService],
})
export class EffectiveCapabilitiesModule {}
