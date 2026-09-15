import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VoiceTranslationController } from './voice-translation.controller.js';
import { VoiceTranslationService } from './voice-translation.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [VoiceTranslationController],
  providers: [VoiceTranslationService],
  exports: [VoiceTranslationService],
})
export class VoiceTranslationModule {}
