import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateImportSourceDto {
  @ApiPropertyOptional({ example: 'Legacy DMS' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  is_default?: boolean;
}
