import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INSPECTION_NOTES_MAX_LENGTH } from '../workshop-inspection-limits.js';

export class UpdateWorkshopInspectionItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  passed?: boolean | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: INSPECTION_NOTES_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(INSPECTION_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class UpdateWorkshopInspectionDto {
  @ApiProperty({ type: [UpdateWorkshopInspectionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateWorkshopInspectionItemDto)
  items!: UpdateWorkshopInspectionItemDto[];
}
