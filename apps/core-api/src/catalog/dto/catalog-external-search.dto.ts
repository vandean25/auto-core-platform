import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { IsArray } from 'class-validator';

export class CatalogExternalPartsItemDto {
  @ApiProperty()
  externalId!: string;

  @ApiProperty()
  sourceSystem!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  articleNumber!: string;

  @ApiProperty()
  brandLabel!: string;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({ type: Number, nullable: true, required: false })
  costPriceEst?: number | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  ean?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  unit?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  fitmentNotes?: string | null;

  @ApiProperty({ type: [String], required: false })
  oemNumbers?: string[];

  @ApiProperty()
  hitToken!: string;
}

export class CatalogExternalLaborItemDto {
  @ApiProperty()
  externalId!: string;

  @ApiProperty()
  sourceSystem!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  externalOperationCode!: string;

  @ApiProperty({ type: Number, nullable: true, required: false })
  standardAw?: number | null;

  @ApiProperty({ type: Number, nullable: true, required: false })
  plannedHours?: number | null;

  @ApiProperty()
  hitToken!: string;
}

export class CatalogExternalSearchResponseDto {
  @ApiProperty({ enum: ['PARTS', 'LABOR'] })
  concern!: 'PARTS' | 'LABOR';

  @ApiProperty({ enum: ['OEM', 'AFTERMARKET'] })
  sourceUsed!: 'OEM' | 'AFTERMARKET';

  @ApiProperty({
    enum: ['HIT', 'EMPTY', 'ERROR', 'NOT_CONFIGURED'],
  })
  oemStatus!: 'HIT' | 'EMPTY' | 'ERROR' | 'NOT_CONFIGURED';

  @ApiProperty()
  fallbackRequired!: boolean;

  @ApiProperty({ enum: ['EMPTY', 'ERROR'], nullable: true })
  fallbackReason!: 'EMPTY' | 'ERROR' | null;

  @ApiProperty()
  retryOemAvailable!: boolean;

  // prettier-ignore
  @ApiProperty({ type: 'array', items: { oneOf: [{ $ref: getSchemaPath(CatalogExternalPartsItemDto) }, { $ref: getSchemaPath(CatalogExternalLaborItemDto) }] } })
  @IsArray()
  items!: Array<CatalogExternalPartsItemDto | CatalogExternalLaborItemDto>;
}

export class CatalogAssemblyGroupNodeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: () => [CatalogAssemblyGroupNodeDto], required: false })
  children?: CatalogAssemblyGroupNodeDto[];
}

export class CatalogAssemblyGroupsResponseDto {
  @ApiProperty({ type: [CatalogAssemblyGroupNodeDto] })
  groups!: CatalogAssemblyGroupNodeDto[];
}
