import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VoiceTranslationController } from './voice-translation.controller';
import { VoiceTranslationService } from './voice-translation.service';

@Module({
  imports: [PrismaModule],
  controllers: [VoiceTranslationController],
  providers: [VoiceTranslationService],
  exports: [VoiceTranslationService],
})
export class VoiceTranslationModule {}
