import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
} from 'class-validator';

export class SubmitMechanicFindingDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Idempotency key. A duplicate submit with the same command_id returns the original proposal.',
  })
  @IsOptional()
  @IsUUID()
  command_id?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Workshop media ids uploaded by this mechanic for the task. Foreign or closed-task media is rejected.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  media_ids?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Accepted voice-note draft id. When set, the draft must already be ACCEPTED for this task and mechanic.',
  })
  @IsOptional()
  @IsUUID()
  voice_note_draft_id?: string;

  @ApiPropertyOptional({
    description:
      'Optional short label for the advisor queue. Finding text comes from saved mechanic notes.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  summary?: string;
}

export class SubmitMechanicFindingResponseDto {
  @ApiProperty({ format: 'uuid' })
  proposalId!: string;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;

  @ApiProperty({ example: 'workshop_order.mechanic_finding' })
  actionType!: string;
}
