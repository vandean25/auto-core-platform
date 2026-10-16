import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class ActivateInspectionCatalogueDto {
  @ApiProperty({ description: 'Preview fingerprint from staging response' })
  @IsString()
  @Length(64, 64)
  fingerprint!: string;

  @ApiProperty({ description: 'Optimistic concurrency version from preview' })
  @IsInt()
  @Min(0)
  version!: number;
}
