import { ApiProperty } from '@nestjs/swagger';

export class LaborOperationSearchItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  standardAw: number;

  @ApiProperty()
  hourlyRate: number;

  @ApiProperty({ nullable: true })
  categoryName: string | null;
}

export class CatalogPartSearchItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  supplierPartNumber: string;

  @ApiProperty({ nullable: true })
  oemNumber: string | null;

  @ApiProperty()
  description: string;

  @ApiProperty()
  brand: string;

  @ApiProperty()
  quantityOnHand: number;

  @ApiProperty({ nullable: true })
  binLocation: string | null;

  @ApiProperty({ nullable: true })
  costPrice: number | null;

  @ApiProperty({ nullable: true })
  retailPrice: number | null;
}

export class CatalogSearchResponseDto {
  @ApiProperty({ type: [LaborOperationSearchItemDto] })
  labor: LaborOperationSearchItemDto[];

  @ApiProperty({ type: [CatalogPartSearchItemDto] })
  parts: CatalogPartSearchItemDto[];

  @ApiProperty()
  meta: {
    laborCount: number;
    partCount: number;
    limit: number;
  };
}
