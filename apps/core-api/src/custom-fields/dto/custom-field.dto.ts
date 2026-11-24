import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomFieldEntity, CustomFieldType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_CUSTOM_FIELD_KEY_LENGTH,
  MAX_CUSTOM_FIELD_LABEL_LENGTH,
  MAX_CUSTOM_FIELD_PURPOSE_LENGTH,
  MAX_CUSTOM_FIELD_SELECT_OPTIONS,
} from '../custom-fields.constants.js';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ListCustomFieldDefinitionsQueryDto {
  @ApiPropertyOptional({
    enum: CustomFieldEntity,
    enumName: 'CustomFieldEntity',
  })
  @IsOptional()
  @IsEnum(CustomFieldEntity)
  entity?: CustomFieldEntity;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;
}

export class CreateCustomFieldDefinitionDto {
  @ApiProperty({ enum: CustomFieldEntity, enumName: 'CustomFieldEntity' })
  @IsEnum(CustomFieldEntity)
  entity!: CustomFieldEntity;

  @ApiPropertyOptional({
    maxLength: MAX_CUSTOM_FIELD_KEY_LENGTH,
    description: 'Slug key; derived from label when omitted.',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(MAX_CUSTOM_FIELD_KEY_LENGTH)
  key?: string;

  @ApiProperty({ maxLength: MAX_CUSTOM_FIELD_LABEL_LENGTH })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CUSTOM_FIELD_LABEL_LENGTH)
  label!: string;

  @ApiProperty({ enum: CustomFieldType, enumName: 'CustomFieldType' })
  @IsEnum(CustomFieldType)
  type!: CustomFieldType;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_CUSTOM_FIELD_SELECT_OPTIONS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_FIELD_SELECT_OPTIONS)
  @IsString({ each: true })
  options?: string[];

  @ApiProperty({ maxLength: MAX_CUSTOM_FIELD_PURPOSE_LENGTH })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CUSTOM_FIELD_PURPOSE_LENGTH)
  purpose!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  personal_data?: boolean;

  @ApiPropertyOptional({ maxLength: 64, default: 'PARENT_OBJECT' })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(64)
  retention_class?: string;

  @ApiPropertyOptional({
    description:
      'Explicit confirmation that no GDPR Art. 9 special-category data will be stored.',
  })
  @IsOptional()
  @IsBoolean()
  confirmNoArt9?: boolean;
}

export class UpdateCustomFieldDefinitionDto {
  @ApiPropertyOptional({ maxLength: MAX_CUSTOM_FIELD_LABEL_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CUSTOM_FIELD_LABEL_LENGTH)
  label?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_CUSTOM_FIELD_SELECT_OPTIONS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_FIELD_SELECT_OPTIONS)
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ maxLength: MAX_CUSTOM_FIELD_PURPOSE_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CUSTOM_FIELD_PURPOSE_LENGTH)
  purpose?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  personal_data?: boolean;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(64)
  retention_class?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  confirmNoArt9?: boolean;
}

export class ReorderCustomFieldDefinitionsDto {
  @ApiProperty({ enum: CustomFieldEntity, enumName: 'CustomFieldEntity' })
  @IsEnum(CustomFieldEntity)
  entity!: CustomFieldEntity;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}

export class CustomFieldDefinitionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomFieldEntity, enumName: 'CustomFieldEntity' })
  entity!: CustomFieldEntity;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: CustomFieldType, enumName: 'CustomFieldType' })
  type!: CustomFieldType;

  @ApiPropertyOptional({ type: [String], nullable: true })
  options?: string[] | null;

  @ApiProperty()
  purpose!: string;

  @ApiProperty()
  personal_data!: boolean;

  @ApiProperty()
  retention_class!: string;

  @ApiProperty()
  archived!: boolean;

  @ApiProperty()
  sort_order!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
