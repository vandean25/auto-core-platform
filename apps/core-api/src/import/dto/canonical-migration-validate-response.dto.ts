import { ApiProperty } from '@nestjs/swagger';

export class CanonicalMigrationValidationIssueDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ required: false })
  file?: string;

  @ApiProperty({ required: false })
  row?: number;

  @ApiProperty({ required: false })
  external_id?: string;

  @ApiProperty({ required: false })
  field?: string;
}

export class CanonicalMigrationValidateResponseDto {
  @ApiProperty()
  valid!: boolean;

  @ApiProperty({ type: [CanonicalMigrationValidationIssueDto] })
  issues!: CanonicalMigrationValidationIssueDto[];
}
