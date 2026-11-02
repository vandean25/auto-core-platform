import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportEntityType, ImportJobStatus } from '@prisma/client';

export class ImportJobListTotalsDto {
  @ApiProperty()
  create!: number;

  @ApiProperty()
  update!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  error!: number;
}

export class ImportJobListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ImportJobStatus, enumName: 'ImportJobStatus' })
  status!: ImportJobStatus;

  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  entity_type!: ImportEntityType;

  @ApiProperty()
  source_system!: string;

  @ApiProperty()
  file_name!: string;

  @ApiProperty({ type: ImportJobListTotalsDto })
  totals!: ImportJobListTotalsDto;

  @ApiProperty({ type: String, nullable: true })
  created_by!: string | null;

  @ApiProperty()
  created_at!: string;

  @ApiProperty({ type: String, nullable: true })
  applied_at!: string | null;

  @ApiProperty()
  cancellable!: boolean;

  @ApiProperty()
  undoable!: boolean;

  @ApiPropertyOptional()
  apply_failure_code?: string;
}

export class ImportJobListMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class ImportJobListResponseDto {
  @ApiProperty({ type: [ImportJobListItemDto] })
  data!: ImportJobListItemDto[];

  @ApiProperty({ type: ImportJobListMetaDto })
  meta!: ImportJobListMetaDto;
}
