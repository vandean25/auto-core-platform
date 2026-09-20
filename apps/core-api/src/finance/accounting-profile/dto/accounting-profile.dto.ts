import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccountingMappingRuleDto {
  @ApiProperty()
  @IsString()
  sourceCategoryKey!: string;

  @ApiProperty()
  @IsString()
  sourceCategoryLabel!: string;

  @ApiProperty({ enum: ['STANDARD', 'MARGIN_SCHEME'] })
  @IsIn(['STANDARD', 'MARGIN_SCHEME'])
  taxMode!: 'STANDARD' | 'MARGIN_SCHEME';

  @ApiProperty()
  @IsString()
  taxRate!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(16)
  revenueAccount!: string;

  @ApiProperty({ enum: ['automatic', 'manual_bu'] })
  @IsIn(['automatic', 'manual_bu'])
  taxTreatment!: 'automatic' | 'manual_bu';

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  buKey?: string | null;
}

export class UpdateAccountingProfileDto {
  @ApiProperty({ description: 'Optimistic-lock version from the last GET response' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  profileCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  formatVersion?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  chart?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  accountLength?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  advisorNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  clientNumber?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  defaultDebtorAccount?: string | null;

  @ApiPropertyOptional({ type: [AccountingMappingRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountingMappingRuleDto)
  mappingRules?: AccountingMappingRuleDto[];

  @ApiPropertyOptional({
    description: 'Gates DATEV CSV export only; does not affect invoice issuance readiness',
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class SourceCategoryDefinitionDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: ['STANDARD', 'MARGIN_SCHEME'] })
  taxMode!: 'STANDARD' | 'MARGIN_SCHEME';

  @ApiProperty()
  taxRate!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  suggestedRevenueAccount!: string | null;
}

export class AccountingProfileReadinessDto {
  @ApiProperty()
  is_ready!: boolean;

  @ApiProperty({ type: [String] })
  missing_fields!: string[];

  @ApiProperty({ type: [String] })
  unmapped_categories!: string[];
}

export class AccountingProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenant_id!: string;

  @ApiProperty()
  legal_entity_id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  is_enabled!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  profile_code!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  format_version!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  chart!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  account_length!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  advisor_number!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  client_number!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  fiscal_year_start_month!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  default_debtor_account!: string | null;

  @ApiProperty({ type: [AccountingMappingRuleDto] })
  mapping_rules!: AccountingMappingRuleDto[];

  @ApiProperty({ type: [SourceCategoryDefinitionDto] })
  required_source_categories!: SourceCategoryDefinitionDto[];

  @ApiProperty({ type: AccountingProfileReadinessDto })
  mapping_readiness!: AccountingProfileReadinessDto;
}
