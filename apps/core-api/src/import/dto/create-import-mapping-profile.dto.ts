import { ApiProperty } from '@nestjs/swagger';
import { ImportEntityType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateImportMappingProfileDto {
  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  @IsEnum(ImportEntityType)
  entity_type!: ImportEntityType;

  @ApiProperty({ example: 'incadea' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  source_system!: string;

  @ApiProperty({ example: 'Default customer mapping' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  mapping!: Record<string, string>;
}
