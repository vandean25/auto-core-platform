import { ApiProperty } from '@nestjs/swagger';

export class VendorArticleCatalogItemDto {
  @ApiProperty({ example: 'item-uuid' })
  id!: string;

  @ApiProperty({ example: '0204114532' })
  sku!: string;

  @ApiProperty({ example: 'Brake Pad Set' })
  name!: string;
}

export class VendorArticleResponseDto {
  @ApiProperty({ example: 'article-uuid' })
  id!: string;

  @ApiProperty({ example: 'tenant-uuid' })
  tenant_id!: string;

  @ApiProperty({ example: 'vendor-uuid' })
  vendor_id!: string;

  @ApiProperty({ example: 'item-uuid' })
  catalog_item_id!: string;

  @ApiProperty({ example: 'BOS-0204114532' })
  vendor_article_no!: string;

  @ApiProperty({ type: Number, required: false, nullable: true, example: 45.5 })
  last_cost?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true, example: 89.9 })
  last_rrp?: number | null;

  @ApiProperty({ type: VendorArticleCatalogItemDto, required: false })
  catalog_item?: VendorArticleCatalogItemDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
