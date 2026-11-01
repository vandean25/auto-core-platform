import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UndoImportJobDto {
  @ApiPropertyOptional({
    description:
      'Entity IDs of unreferenced records with post-import conflicts that the user explicitly confirmed to revert anyway',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  confirmedEntityIds?: string[];
}
