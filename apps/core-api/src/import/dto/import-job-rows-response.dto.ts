import { ApiProperty } from '@nestjs/swagger';
import { ImportRowAction } from '@prisma/client';

export class ImportJobRowDto {
  @ApiProperty()
  row_no!: number;

  @ApiProperty({ nullable: true })
  external_id!: string | null;

  @ApiProperty({ enum: ImportRowAction, enumName: 'ImportRowAction' })
  action!: ImportRowAction;

  @ApiProperty({ nullable: true })
  entity_id!: string | null;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  errors!: unknown[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  warnings!: unknown[];

  @ApiProperty({ nullable: true, type: Object })
  normalized!: Record<string, unknown> | null;
}

export class ImportJobRowsResponseDto {
  @ApiProperty({ type: [ImportJobRowDto] })
  data!: ImportJobRowDto[];

  @ApiProperty()
  meta!: { total: number; page: number; limit: number };
}
