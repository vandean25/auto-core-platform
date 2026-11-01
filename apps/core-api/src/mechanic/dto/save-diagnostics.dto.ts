import { ApiProperty } from '@nestjs/swagger';
import { WorkshopInspectionSeverity } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { INSPECTION_NOTES_MAX_LENGTH } from '../../workshop/workshop-inspection-limits.js';

export class InspectionItemValueDto {
  // Only `notes` is capped here. responseValue holds a measurement rather than free text, and mechanicNotes on
  // SaveDiagnosticsDto has a second writer in UpdateWorkshopTaskDto. Capping one REST path of a column the other
  // paths still leave open would recreate the disagreement this ticket removes, so both wait for a ticket that
  // caps every writer at once.
  @ApiProperty({ description: 'WorkshopInspectionItem.id to update' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  @IsString()
  @IsOptional()
  responseValue?: string | null;

  @ApiProperty({ type: Boolean, required: false, nullable: true })
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

  // Same cap as the checklist and check-in routes: all four of them write this one column.
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    maxLength: INSPECTION_NOTES_MAX_LENGTH,
  })
  @IsString()
  @IsOptional()
  @MaxLength(INSPECTION_NOTES_MAX_LENGTH)
  notes?: string | null;
}

/**
 * Payload for the debounced auto-save diagnostics endpoint.
 * All fields are optional: the client may send a partial update
 * after each debounce interval (ADR-0014 §5.1).
 */
export class SaveDiagnosticsDto {
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description: 'Free-text mechanic diagnostic notes saved to the task.',
  })
  @IsString()
  @IsOptional()
  mechanicNotes?: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    required: false,
    nullable: true,
    description:
      'Optional voice-note draft id to accept while saving diagnostics.',
  })
  @IsUUID()
  @IsOptional()
  voiceNoteDraftId?: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
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
