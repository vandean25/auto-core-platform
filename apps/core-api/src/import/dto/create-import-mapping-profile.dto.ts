import { ApiProperty } from '@nestjs/swagger';
import { ImportEntityType } from '@prisma/client';

export class CreateImportMappingProfileDto {
  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  entity_type!: ImportEntityType;

  @ApiProperty({ example: 'incadea' })
  source_system!: string;

  @ApiProperty({ example: 'Default customer mapping' })
  name!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  mapping!: Record<string, string>;
}
