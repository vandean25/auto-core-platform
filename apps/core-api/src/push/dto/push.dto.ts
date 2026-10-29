import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationEventType, PushPlatform } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PUSH_USER_EVENT_TYPES } from '../push.constants.js';

export class RegisterPushDeviceDto {
  @ApiProperty({
    maxLength: 4096,
    description:
      'FCM registration token of this browser. Stored, never returned and never logged.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: PushPlatform, enumName: 'PushPlatform' })
  @IsIn(Object.values(PushPlatform))
  platform!: PushPlatform;

  @ApiPropertyOptional({
    maxLength: 32,
    description: 'Browser family only, for example "chrome".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  browser?: string;

  @ApiPropertyOptional({
    description: 'True when the app runs as an installed PWA.',
  })
  @IsOptional()
  @IsBoolean()
  installed?: boolean;
}

export class PushDeviceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PushPlatform, enumName: 'PushPlatform' })
  platform!: PushPlatform;
  @ApiProperty({ nullable: true, type: String }) browser!: string | null;
  @ApiProperty() installed!: boolean;
  @ApiProperty({ format: 'date-time' }) lastSeenAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PushPreferencesDto {
  @ApiProperty({
    enum: PUSH_USER_EVENT_TYPES,
    enumName: 'PushUserEventType',
    isArray: true,
    description: 'Events this user wants as push. Empty by default.',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(PUSH_USER_EVENT_TYPES, { each: true })
  enabledEvents!: NotificationEventType[];

  @ApiProperty({
    nullable: true,
    type: Number,
    minimum: 0,
    maximum: 1439,
    description:
      'Quiet hours start, minutes after midnight in the site timezone. Null together with the end means none.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  quietStartMin!: number | null;

  @ApiProperty({ nullable: true, type: Number, minimum: 0, maximum: 1439 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  quietEndMin!: number | null;
}

export class PushTestResponseDto {
  @ApiProperty({ description: 'Outbox row that carries the test push.' })
  id!: string;
}
