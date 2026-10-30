import { ApiProperty } from '@nestjs/swagger';

export class ImportSourceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'legacy-dms' })
  key!: string;

  @ApiProperty({ example: 'Legacy DMS' })
  label!: string;

  @ApiProperty()
  is_default!: boolean;

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;
}

export class ImportSourceListResponseDto {
  @ApiProperty({ type: [ImportSourceResponseDto] })
  data!: ImportSourceResponseDto[];
}
