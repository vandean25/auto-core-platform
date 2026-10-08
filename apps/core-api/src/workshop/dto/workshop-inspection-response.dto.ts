import { ApiProperty } from '@nestjs/swagger';

export class WorkshopInspectionItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  label_snapshot!: string;

  @ApiProperty({ type: Boolean, nullable: true })
  passed!: boolean | null;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unit!: string | null;
}

export class WorkshopInspectionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [WorkshopInspectionItemResponseDto] })
  items!: WorkshopInspectionItemResponseDto[];
}
