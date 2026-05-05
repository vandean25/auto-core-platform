import { Module } from '@nestjs/common';
import OpenAI from 'openai';
import { SpeechNoteConfigError } from './speech-note.errors';
import {
  SPEECH_NOTE_OPENAI_CLIENT,
  SpeechNoteService,
} from './speech-note.service';

@Module({
  providers: [
    {
      provide: SPEECH_NOTE_OPENAI_CLIENT,
      useFactory: (): OpenAI => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new SpeechNoteConfigError(
            'OPENAI_API_KEY environment variable is required for speech-note processing. ' +
              'Configure this variable on the server; never expose it to the browser.',
          );
        }
        return new OpenAI({ apiKey });
      },
    },
    SpeechNoteService,
  ],
  exports: [SpeechNoteService],
})
export class SpeechNoteModule {}
