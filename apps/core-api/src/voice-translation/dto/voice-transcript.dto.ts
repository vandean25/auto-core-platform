import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ALLOWED_TRANSCRIPT_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
]);

export const MAX_TRANSCRIPT_BYTES = 25 * 1024 * 1024;
export const MIN_TRANSCRIPT_BYTES = 100;

export class VoiceTranscriptResponseDto {
  @ApiProperty({
    description: 'Recognized speech, ready to be edited before interpret.',
  })
  transcript!: string;

  @ApiProperty({ example: 'de-AT' })
  sourceLanguageCode!: string;

  @ApiPropertyOptional({ example: 'de-AT' })
  detectedLanguageCode?: string;

  @ApiProperty({ example: 'google-cloud' })
  provider!: string;

  @ApiProperty({ example: 'latest_long' })
  model!: string;
}
