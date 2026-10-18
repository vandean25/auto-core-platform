import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class DocumentBrandExpectedRevisionField {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
