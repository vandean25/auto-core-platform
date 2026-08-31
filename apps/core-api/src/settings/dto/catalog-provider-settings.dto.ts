import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CatalogOemConcernCode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CatalogProviderMemberMakeDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'Peugeot' })
  name!: string;
}

export class CatalogProviderOemConcernResponseDto {
  @ApiProperty({ enum: CatalogOemConcernCode, example: 'STELLANTIS' })
  code!: CatalogOemConcernCode;

  @ApiPropertyOptional({
    description: 'OEM parts adapter id for this concern.',
    nullable: true,
    type: String,
  })
  partsAdapterId!: string | null;

  @ApiPropertyOptional({
    description: 'OEM labor adapter id for this concern.',
    nullable: true,
    type: String,
  })
  laborAdapterId!: string | null;

  @ApiProperty({
    description:
      'Whether OEM parts credentials are configured in tenant secrets.',
  })
  hasPartsCredential!: boolean;

  @ApiProperty({
    description:
      'Whether OEM labor credentials are configured in tenant secrets.',
  })
  hasLaborCredential!: boolean;

  @ApiProperty({
    type: [CatalogProviderMemberMakeDto],
    description: 'Vehicle-make brands assigned to this OEM concern.',
  })
  memberMakes!: CatalogProviderMemberMakeDto[];
}

export class CatalogProviderDefaultLaborCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'General Workshop' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Default hourly selling rate for this category.',
    nullable: true,
    type: Number,
  })
  defaultHourlyRate!: number | null;
}

export class CatalogProviderSettingsResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({
    description: 'Default vehicle identity adapter id.',
    nullable: true,
    type: String,
  })
  defaultIdentityAdapterId!: string | null;

  @ApiPropertyOptional({
    description: 'Default aftermarket parts adapter id.',
    nullable: true,
    type: String,
  })
  defaultPartsAftermarketAdapterId!: string | null;

  @ApiPropertyOptional({
    description: 'Default aftermarket labor adapter id.',
    nullable: true,
    type: String,
  })
  defaultLaborAftermarketAdapterId!: string | null;

  @ApiPropertyOptional({
    description: 'Default labor category used for external labor catalog hits.',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  defaultLaborCategoryId!: string | null;

  @ApiPropertyOptional({
    description: 'Summary of the configured default labor category.',
    nullable: true,
    type: CatalogProviderDefaultLaborCategoryDto,
  })
  defaultLaborCategory!: CatalogProviderDefaultLaborCategoryDto | null;

  @ApiProperty({
    description:
      'Minutes per AW (Arbeitswert) used when converting provider AW to hours.',
    example: 6,
  })
  awMinutes!: number;

  @ApiProperty({
    description:
      'Whether identity provider credentials are configured in tenant secrets.',
  })
  hasIdentityCredential!: boolean;

  @ApiProperty({
    description:
      'Whether aftermarket parts provider credentials are configured in tenant secrets.',
  })
  hasPartsAftermarketCredential!: boolean;

  @ApiProperty({
    description:
      'Whether aftermarket labor provider credentials are configured in tenant secrets.',
  })
  hasLaborAftermarketCredential!: boolean;

  @ApiProperty({
    type: [CatalogProviderOemConcernResponseDto],
    description:
      'OEM concerns (BMW, Mercedes, Stellantis) and their member makes.',
  })
  oemConcerns!: CatalogProviderOemConcernResponseDto[];

  @ApiProperty()
  updatedAt!: Date;
}

export class UpdateCatalogProviderOemConcernDto {
  @ApiProperty({ enum: CatalogOemConcernCode, example: 'STELLANTIS' })
  @IsEnum(CatalogOemConcernCode)
  code!: CatalogOemConcernCode;

  @ApiProperty({
    type: [Number],
    description: 'Vehicle-make brand ids assigned to this OEM concern.',
    example: [1, 2, 3],
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  memberBrandIds!: number[];
}

export class UpdateCatalogProviderSettingsDto {
  @ApiPropertyOptional({
    description: 'Default vehicle identity adapter id.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  defaultIdentityAdapterId?: string | null;

  @ApiPropertyOptional({
    description: 'Default aftermarket parts adapter id.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  defaultPartsAftermarketAdapterId?: string | null;

  @ApiPropertyOptional({
    description: 'Default aftermarket labor adapter id.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  defaultLaborAftermarketAdapterId?: string | null;

  @ApiPropertyOptional({
    description: 'Default labor category used for external labor catalog hits.',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  defaultLaborCategoryId?: string | null;

  @ApiPropertyOptional({
    description: 'Minutes per AW (Arbeitswert). Must be a positive integer.',
    example: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  awMinutes?: number;

  @ApiPropertyOptional({
    type: [UpdateCatalogProviderOemConcernDto],
    description: 'OEM concern member-make assignments to upsert.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCatalogProviderOemConcernDto)
  oemConcerns?: UpdateCatalogProviderOemConcernDto[];
}
