import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class PreviewInspectionCatalogueDto {
  @ApiProperty({
    description: 'Allowlisted manifest reference (synthetic statutory subset)',
    example: 'ACP-RIS-Anl6-258-2022-subset',
  })
  @IsString()
  @MaxLength(128)
  manifest_reference!: string;
}
