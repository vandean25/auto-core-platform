import { ApiProperty } from '@nestjs/swagger';
import { ImportEntityType, ImportJobStatus } from '@prisma/client';

export class ImportJobTotalsDto {
  @ApiProperty()
  rows!: number;

  @ApiProperty()
  create!: number;

  @ApiProperty()
  update!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  error!: number;
}

export class ImportJobResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  entity_type!: ImportEntityType;

  @ApiProperty()
  source_system!: string;

  @ApiProperty()
  file_name!: string;

  @ApiProperty()
  file_sha256!: string;

  @ApiProperty({ enum: ImportJobStatus, enumName: 'ImportJobStatus' })
  status!: ImportJobStatus;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  mapping!: Record<string, string>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  options!: Record<string, unknown>;

  @ApiProperty({ type: ImportJobTotalsDto })
  totals!: ImportJobTotalsDto;

  @ApiProperty({ nullable: true })
  created_by!: string | null;

  @ApiProperty()
  created_at!: string;

  @ApiProperty({ nullable: true })
  applied_at!: string | null;
}
