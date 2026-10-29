import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateImportSourceDto {
  @ApiPropertyOptional({ example: 'Legacy DMS' })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'label must not be blank' })
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  is_default?: boolean;
}
