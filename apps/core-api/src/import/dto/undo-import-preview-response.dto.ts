import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportUndoCountsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  toDelete!: number;

  @ApiProperty()
  toRestore!: number;

  @ApiProperty()
  conflicts!: number;

  @ApiProperty()
  blocked!: number;
}

export class ImportUndoRowPreviewDto {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty()
  entityType!: string;

  @ApiPropertyOptional({ nullable: true })
  entityId?: string | null;

  @ApiProperty({ enum: ['CREATE', 'UPDATE'] })
  action!: 'CREATE' | 'UPDATE';

  @ApiProperty({ enum: ['ELIGIBLE', 'CONFLICT', 'BLOCKED'] })
  status!: 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED';

  @ApiPropertyOptional()
  reason?: string;

  @ApiPropertyOptional({ type: [String] })
  references?: string[];

  @ApiPropertyOptional()
  displayName?: string;
}

export class ImportUndoPreviewResponseDto {
  @ApiProperty()
  jobId!: string;

  @ApiProperty({ enum: ['ELIGIBLE', 'CONFLICT', 'BLOCKED'] })
  status!: 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED';

  @ApiProperty()
  canUndo!: boolean;

  @ApiProperty({ type: ImportUndoCountsDto })
  counts!: ImportUndoCountsDto;

  @ApiProperty({ type: [ImportUndoRowPreviewDto] })
  deletions!: ImportUndoRowPreviewDto[];

  @ApiProperty({ type: [ImportUndoRowPreviewDto] })
  restorations!: ImportUndoRowPreviewDto[];

  @ApiProperty({ type: [ImportUndoRowPreviewDto] })
  conflicts!: ImportUndoRowPreviewDto[];

  @ApiProperty({ type: [ImportUndoRowPreviewDto] })
  blocked!: ImportUndoRowPreviewDto[];
}
