import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CustomerConsentBasis,
  CustomerConsentChannel,
  CustomerConsentPurpose,
  CustomerConsentSource,
  CustomerConsentStatus,
  CustomerCommunicationProcessingStatus,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';

export class RecordCommunicationEventDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  controller_legal_entity_id?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  expected_revision!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotency_key!: string;

  @ApiProperty({ enum: CustomerConsentChannel })
  @IsEnum(CustomerConsentChannel)
  channel!: CustomerConsentChannel;

  @ApiProperty({ enum: CustomerConsentPurpose })
  @IsEnum(CustomerConsentPurpose)
  purpose!: CustomerConsentPurpose;

  @ApiProperty({ enum: CustomerConsentStatus })
  @IsEnum(CustomerConsentStatus)
  status!: CustomerConsentStatus;

  @ApiPropertyOptional({ enum: CustomerConsentBasis })
  @IsOptional()
  @IsEnum(CustomerConsentBasis)
  basis?: CustomerConsentBasis;

  @ApiProperty({ enum: CustomerConsentSource })
  @IsEnum(CustomerConsentSource)
  source!: CustomerConsentSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contact_address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  occurred_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  text_version?: string;

  @ApiPropertyOptional({ example: 'de' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  text_language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text_snapshot?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;
}

export class ChannelPreferenceDto {
  @ApiProperty({ enum: CustomerConsentChannel })
  channel!: CustomerConsentChannel;

  @ApiProperty({ enum: CustomerConsentPurpose })
  purpose!: CustomerConsentPurpose;

  @ApiProperty({ enum: CustomerConsentStatus, nullable: true })
  effective_status!: CustomerConsentStatus | null;

  @ApiProperty()
  allowed!: boolean;

  @ApiProperty()
  reason!: string;
}

export class CommunicationPreferencesResponseDto {
  @ApiProperty({ format: 'uuid' })
  customer_id!: string;

  @ApiProperty({ format: 'uuid' })
  controller_legal_entity_id!: string;

  @ApiPropertyOptional({ nullable: true })
  controller_legal_entity_name?: string | null;

  @ApiProperty()
  revision!: number;

  @ApiProperty({ enum: CustomerCommunicationProcessingStatus })
  processing_status!: CustomerCommunicationProcessingStatus;

  @ApiProperty({ type: [ChannelPreferenceDto] })
  preferences!: ChannelPreferenceDto[];
}

export class CommunicationEventSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: CustomerConsentChannel })
  channel!: CustomerConsentChannel;

  @ApiProperty({ enum: CustomerConsentPurpose })
  purpose!: CustomerConsentPurpose;

  @ApiProperty({ enum: CustomerConsentStatus })
  status!: CustomerConsentStatus;

  @ApiPropertyOptional({ enum: CustomerConsentBasis, nullable: true })
  basis?: CustomerConsentBasis | null;

  @ApiProperty()
  sequence!: number;

  @ApiProperty()
  recorded_at!: string;

  @ApiProperty()
  occurred_at!: string;

  @ApiProperty({ enum: CustomerConsentSource })
  source!: CustomerConsentSource;

  @ApiPropertyOptional({ nullable: true })
  revoked_at?: string | null;
}

export class CommunicationHistoryResponseDto {
  @ApiProperty({ type: [CommunicationEventSummaryDto] })
  data!: CommunicationEventSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta!: PaginationMetaDto;
}

export class CommunicationEventResponseDto extends CommunicationEventSummaryDto {
  @ApiProperty()
  revision!: number;
}
