import { ApiProperty } from '@nestjs/swagger';

export class CatalogLaborSearchItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  standardAw!: number;

  @ApiProperty()
  hourlyRate!: number;

  @ApiProperty({ type: String, nullable: true })
  categoryName!: string | null;
}

export class CatalogPartSearchItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  supplierPartNumber!: string;

  @ApiProperty({ type: String, nullable: true })
  oemNumber!: string | null;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  brand!: string;

  @ApiProperty()
  quantityOnHand!: number;

  @ApiProperty({ type: String, nullable: true })
  binLocation!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  costPrice!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  retailPrice!: number | null;
}

export class CatalogSearchMetaDto {
  @ApiProperty()
  laborCount!: number;

  @ApiProperty()
  partCount!: number;

  @ApiProperty()
  limit!: number;
}

export class CatalogSearchResponseDto {
  @ApiProperty({ type: [CatalogLaborSearchItemDto] })
  labor!: CatalogLaborSearchItemDto[];

  @ApiProperty({ type: [CatalogPartSearchItemDto] })
  parts!: CatalogPartSearchItemDto[];

  @ApiProperty({ type: () => CatalogSearchMetaDto })
  meta!: CatalogSearchMetaDto;
}
