import { Module } from '@nestjs/common';
import OpenAI from 'openai';
import {
  SPEECH_NOTE_OPENAI_CLIENT,
  SpeechNoteService,
} from './speech-note.service';

@Module({
  providers: [
    {
      provide: SPEECH_NOTE_OPENAI_CLIENT,
      /**
       * Returns an initialised OpenAI client when OPENAI_API_KEY is configured,
       * or `null` when the variable is absent.
       *
       * Returning `null` rather than throwing here ensures that the rest of the
       * application can boot (and existing e2e test suites can compile) in
       * environments where OPENAI_API_KEY has not been provisioned yet.
       * SpeechNoteService validates the client at call time and raises a clear
       * SpeechNoteConfigError if it is null.
       */
      useFactory: (): OpenAI | null => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return null;
        }
        return new OpenAI({ apiKey });
      },
    },
    SpeechNoteService,
  ],
  exports: [SpeechNoteService],
})
export class SpeechNoteModule {}
