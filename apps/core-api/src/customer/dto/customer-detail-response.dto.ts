import { CustomerType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CustomerHistoryMetaDto {
  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalCount: number;

  @ApiProperty()
  pageCount: number;

  @ApiProperty()
  hasMore: boolean;
}

export class CustomerDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: CustomerType })
  type: CustomerType;

  @ApiProperty({ required: false, nullable: true })
  company_name?: string | null;

  @ApiProperty()
  first_name: string;

  @ApiProperty()
  last_name: string;

  @ApiProperty({ required: false, nullable: true })
  email?: string | null;

  @ApiProperty({ required: false, nullable: true })
  phone?: string | null;

  @ApiProperty({ required: false, nullable: true })
  vat_id?: string | null;

  @ApiProperty({ required: false, nullable: true })
  address_street?: string | null;

  @ApiProperty({ required: false, nullable: true })
  address_city?: string | null;

  @ApiProperty({ required: false, nullable: true })
  address_zip?: string | null;

  @ApiProperty({ required: false, nullable: true })
  address_country?: string | null;

  @ApiProperty({
    required: false,
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  vehicles?: Record<string, unknown>[];

  @ApiProperty({
    required: false,
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  sales_orders?: Record<string, unknown>[];

  @ApiProperty({
    required: false,
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  workshop_orders?: Record<string, unknown>[];

  @ApiProperty({
    required: false,
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  invoices?: Record<string, unknown>[];

  @ApiProperty({ type: CustomerHistoryMetaDto })
  workshop_orders_meta: CustomerHistoryMetaDto;

  @ApiProperty({ type: CustomerHistoryMetaDto })
  invoices_meta: CustomerHistoryMetaDto;
}
