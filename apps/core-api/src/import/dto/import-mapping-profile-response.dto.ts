import { ApiProperty } from '@nestjs/swagger';
import { ImportEntityType } from '@prisma/client';

export class ImportMappingProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  entity_type!: ImportEntityType;

  @ApiProperty()
  source_system!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  mapping!: Record<string, string>;

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;
}

export class ImportMappingProfileListResponseDto {
  @ApiProperty({ type: [ImportMappingProfileResponseDto] })
  data!: ImportMappingProfileResponseDto[];
}
