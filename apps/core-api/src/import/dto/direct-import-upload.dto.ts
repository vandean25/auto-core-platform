import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ImportEntityType } from '@prisma/client';

export class StartDirectImportUploadDto {
  @ApiProperty({ example: 'kunden-export.csv' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    description: 'Declared file size in bytes; capped by the server limit',
    example: 104_857_600,
  })
  @IsInt()
  @Min(1)
  size!: number;

  @ApiPropertyOptional({ example: 'text/csv' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  contentType?: string;
}

export class FinalizeDirectImportUploadDto {
  @ApiProperty({ example: 'kunden-export.csv' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    description: 'Size declared when the upload was started',
    example: 104_857_600,
  })
  @IsInt()
  @Min(1)
  size!: number;

  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  @IsEnum(ImportEntityType)
  entityType!: ImportEntityType;

  @ApiProperty({ example: 'legacy-dms' })
  @IsString()
  @IsNotEmpty()
  sourceSystem!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { external_id: 'Kunden-Nr' },
  })
  @IsObject()
  mapping!: Record<string, string>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}
