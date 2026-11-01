import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VoiceTranslationController } from './voice-translation.controller.js';
import { VoiceTranslationService } from './voice-translation.service.js';
import { VoiceTranscriptGuard } from './voice-transcript.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [VoiceTranslationController],
  providers: [VoiceTranslationService, VoiceTranscriptGuard],
  exports: [VoiceTranslationService],
})
export class VoiceTranslationModule {}
