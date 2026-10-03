import { ApiProperty } from '@nestjs/swagger';

export class PickerlWarningDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;
}

export class PickerlDueDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Next due month as YYYY-MM',
    example: '2027-03',
  })
  due_month!: string | null;

  @ApiProperty({
    enum: ['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN'],
    enumName: 'PickerlDueStatus',
  })
  status!: 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN';

  @ApiProperty()
  rule_id!: string;

  @ApiProperty({ type: [PickerlWarningDto] })
  warnings!: PickerlWarningDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Latest recorded inspection date (YYYY-MM-DD)',
    example: '2024-05-12',
  })
  last_inspected_on!: string | null;
}
