import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/** Inverse payload for the AUT-876 pilot: restore internal notes with a version guard. */
export class UndoWorkshopOrderNotesDto {
  @ApiProperty({
    description:
      'Notes value before the edit being undone. Omit or null to restore an empty field.',
    nullable: true,
    required: false,
    type: String,
  })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @IsOptional()
  previousNotes?: string | null;

  @ApiProperty({
    description:
      'ISO timestamp of updatedAt immediately after the committed notes edit.',
  })
  @IsDateString()
  expectedUpdatedAt!: string;
}
