import { ApiProperty } from '@nestjs/swagger';
import { ImportEntityType } from '@prisma/client';

export class ImportTemplateFieldDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label_de!: string;

  @ApiProperty()
  required!: boolean;
}

export class ImportTemplateResponseDto {
  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  entity_type!: ImportEntityType;

  @ApiProperty({ type: [ImportTemplateFieldDto] })
  fields!: ImportTemplateFieldDto[];

  @ApiProperty({ description: 'CSV template with German headers' })
  csv!: string;
}
