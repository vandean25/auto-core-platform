import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum PublicEstimateDecision {
  APPROVE = 'APPROVE',
  DECLINE = 'DECLINE',
}

/** The customer's decision on a sent estimate. Approval needs the confirmations; a decline needs none. */
export class PublicEstimateDecisionDto {
  @ApiProperty({
    enum: PublicEstimateDecision,
    enumName: 'PublicEstimateDecision',
  })
  @IsEnum(PublicEstimateDecision)
  decision!: PublicEstimateDecision;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  typed_full_name?: string;

  @ApiProperty({
    description:
      'The customer has read the legal blocks shown above the button. Must be true to approve.',
  })
  @IsBoolean()
  legal_blocks_accepted!: boolean;

  @ApiProperty({
    description:
      'The customer has accepted the B2C non-binding declaration (KSchG § 5 Abs 2). Must be true to approve.',
  })
  @IsBoolean()
  b2c_declaration_accepted!: boolean;
}
