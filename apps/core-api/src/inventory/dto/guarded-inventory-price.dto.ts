import { ApiProperty } from '@nestjs/swagger';
import { CatalogItemResponseDto } from './inventory-response.dto.js';

export class GuardedInventoryPricePatchDto {
  @ApiProperty()
  retail_price!: number;

  @ApiProperty({ type: 'integer', format: 'int64' })
  expectedRevision!: number;
}

export class GuardedPriceReceiptDto extends CatalogItemResponseDto {}

export class GuardedPriceErrorDto {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];

  @ApiProperty()
  error!: string;

  @ApiProperty({ required: false })
  code?: string;
}
