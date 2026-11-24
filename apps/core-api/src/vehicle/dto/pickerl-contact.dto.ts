import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PickerlContactChannel,
  PickerlContactOutcome,
  PickerlNoConsentReason,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class RecordPickerlContactDto {
  @ApiPropertyOptional({
    enum: PickerlContactChannel,
    default: PickerlContactChannel.PHONE,
  })
  @IsOptional()
  @IsEnum(PickerlContactChannel)
  channel?: PickerlContactChannel;

  @ApiPropertyOptional({ enum: PickerlContactOutcome })
  @IsOptional()
  @IsEnum(PickerlContactOutcome)
  outcome?: PickerlContactOutcome;

  @ApiPropertyOptional({
    description: 'Contact timestamp (ISO-8601). Defaults to server now.',
  })
  @IsOptional()
  @IsISO8601()
  contacted_at?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Due month (YYYY-MM) this contact refers to. Defaults to current due_month.',
    example: '2026-03',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'due_month must be in YYYY-MM format.',
  })
  due_month?: string | null;

  @ApiPropertyOptional({
    enum: PickerlNoConsentReason,
    description:
      'Required when logging a PHONE contact for a customer without active PHONE consent.',
  })
  @IsOptional()
  @IsEnum(PickerlNoConsentReason)
  no_consent_reason?: PickerlNoConsentReason;

  @ApiPropertyOptional({
    description:
      'When true, immediately revokes active PHONE consents for PICKERL_REMINDER and SERVICE_REMINDER.',
  })
  @IsOptional()
  @IsBoolean()
  revoke_phone_consent?: boolean;
}

export class PickerlContactLogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty({ type: String, nullable: true })
  customer_id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  due_month!: string | null;

  @ApiProperty()
  contacted_at!: string;

  @ApiProperty({ enum: PickerlContactChannel })
  channel!: PickerlContactChannel;

  @ApiProperty({ enum: PickerlContactOutcome, nullable: true })
  outcome!: PickerlContactOutcome | null;

  @ApiProperty({ enum: PickerlNoConsentReason, nullable: true })
  no_consent_reason!: PickerlNoConsentReason | null;

  @ApiProperty({ type: String, nullable: true })
  actor_member_id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  actor_name!: string | null;

  @ApiProperty()
  phone_consent_allowed!: boolean;
}
