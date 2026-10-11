import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { WouldChangeItem } from '../dry-run.types.js';

export class WouldChangeItemDto implements WouldChangeItem {
  @ApiProperty({
    description: 'The entity/model name that would change',
    example: 'Customer',
  })
  entity!: string;

  @ApiProperty({
    description: 'The ID of the record that would change',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    enum: ['create', 'update', 'delete'],
    description: 'The operation that would occur',
    example: 'create',
  })
  op!: 'create' | 'update' | 'delete';

  @ApiProperty({
    description:
      'True when the id is not a committed row id: the preview rolled the row back, so the committed write creates a different id. Do not reuse this id; use the id the committed result returns.',
    example: true,
  })
  provisional!: boolean;
}

export class DryRunMetaDto {
  @ApiPropertyOptional({
    description: 'Indicates whether the request was executed in dry-run mode',
    example: true,
  })
  dry_run?: boolean;

  @ApiPropertyOptional({
    type: [WouldChangeItemDto],
    description: 'List of changes that would occur if executed without dry_run',
  })
  would_change?: WouldChangeItemDto[];
}
