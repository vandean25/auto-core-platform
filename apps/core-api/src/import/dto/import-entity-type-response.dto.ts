import { ApiProperty } from '@nestjs/swagger';
import {
  IMPLEMENTED_IMPORT_ENTITY_TYPES,
  listImportEntityTypes,
  type ImplementedImportEntityType,
} from '../import-entity-type.registry.js';

export class ImportEntityTypeResponseDto {
  @ApiProperty({
    enum: IMPLEMENTED_IMPORT_ENTITY_TYPES,
    enumName: 'ImplementedImportEntityType',
  })
  entity_type!: ImplementedImportEntityType;

  @ApiProperty({
    description: 'Offered in the settings import wizard; otherwise API-only',
  })
  wizard!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Template field keys that every CSV row must map',
  })
  required_fields!: string[];
}

export class ImportEntityTypeListResponseDto {
  @ApiProperty({
    type: [ImportEntityTypeResponseDto],
    example: listImportEntityTypes(),
  })
  data!: ImportEntityTypeResponseDto[];
}
