import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateImportSourceDto {
  @ApiProperty({
    example: 'legacy-dms',
    description:
      'Normalized lower-case slug key (alphanumeric, hyphens, underscores; max 64 chars)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key!: string;

  @ApiProperty({ example: 'Legacy DMS' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  is_default?: boolean;
}
