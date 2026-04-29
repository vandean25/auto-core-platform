import { ApiProperty } from '@nestjs/swagger';
import { WorkshopInspectionSeverity } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InspectionItemValueDto {
  @ApiProperty({ description: 'WorkshopInspectionItem.id to update' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsString()
  @IsOptional()
  responseValue?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsBoolean()
  @IsOptional()
  passed?: boolean | null;

  @ApiProperty({
    enum: WorkshopInspectionSeverity,
    required: false,
    nullable: true,
  })
  @IsEnum(WorkshopInspectionSeverity)
  @IsOptional()
  severity?: WorkshopInspectionSeverity | null;

  @ApiProperty({ required: false, nullable: true })
  @IsString()
  @IsOptional()
  notes?: string | null;
}

/**
 * Payload for the debounced auto-save diagnostics endpoint.
 * All fields are optional: the client may send a partial update
 * after each debounce interval (ADR-0014 §5.1).
 */
export class SaveDiagnosticsDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Free-text mechanic diagnostic notes saved to the task.',
  })
  @IsString()
  @IsOptional()
  mechanicNotes?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'ID of the WorkshopInspection instance to update checklist items for.',
  })
  @IsUUID()
  @IsOptional()
  inspectionId?: string | null;

  @ApiProperty({
    type: [InspectionItemValueDto],
    required: false,
    description: 'Inspection item values to upsert.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionItemValueDto)
  @IsOptional()
  inspectionItems?: InspectionItemValueDto[];
}

export class SaveDiagnosticsResponseDto {
  @ApiProperty()
  taskId!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  mechanicNotes?: string | null;
}
