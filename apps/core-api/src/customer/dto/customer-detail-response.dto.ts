import {
  CustomerType,
  InvoiceStatus,
  SalesOrderStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CustomerHistoryMetaDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  totalCount!: number;

  @ApiProperty()
  pageCount!: number;

  @ApiProperty()
  hasMore!: boolean;
}

export class CustomerDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomerType })
  type!: CustomerType;

  @ApiProperty({ type: String, required: false, nullable: true })
  company_name?: string | null;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  email?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  phone?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  vat_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_street?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_city?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_zip?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_country?: string | null;

  @ApiProperty({
    required: false,
    type: () => [VehicleSummaryDto],
    maxItems: 100,
  })
  vehicles?: VehicleSummaryDto[];

  @ApiProperty({
    required: false,
    type: () => [SalesOrderSummaryDto],
    maxItems: 100,
  })
  sales_orders?: SalesOrderSummaryDto[];

  @ApiProperty({
    required: false,
    type: () => [WorkshopOrderSummaryDto],
    maxItems: 100,
  })
  workshop_orders?: WorkshopOrderSummaryDto[];

  @ApiProperty({
    required: false,
    type: () => [InvoiceSummaryDto],
    maxItems: 100,
  })
  invoices?: InvoiceSummaryDto[];

  @ApiProperty({ type: CustomerHistoryMetaDto })
  workshop_orders_meta!: CustomerHistoryMetaDto;

  @ApiProperty({ type: CustomerHistoryMetaDto })
  invoices_meta!: CustomerHistoryMetaDto;
}

export class VehicleSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  vin?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  plate?: string | null;
}

export class SalesOrderSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order_number!: string;

  @ApiProperty({ enum: SalesOrderStatus })
  status!: SalesOrderStatus;

  @ApiProperty()
  total_amount!: string;

  @ApiProperty()
  createdAt!: string;
}

export class WorkshopTaskLineItemSummaryDto {
  @ApiProperty()
  quantity!: string;

  @ApiProperty()
  unit_price!: string;
}

export class WorkshopTaskSummaryDto {
  @ApiProperty({
    required: false,
    type: () => [WorkshopTaskLineItemSummaryDto],
  })
  line_items?: WorkshopTaskLineItemSummaryDto[];
}

export class WorkshopOrderSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: WorkshopOrderStatus })
  status!: WorkshopOrderStatus;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  vehicle_id?: string | null;

  @ApiProperty({ required: false, type: () => VehicleSummaryDto })
  vehicle?: VehicleSummaryDto;

  @ApiProperty({
    required: false,
    type: () => [WorkshopTaskSummaryDto],
  })
  tasks?: WorkshopTaskSummaryDto[];
}

export class InvoiceSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  invoice_number!: string | null;

  @ApiProperty({ enum: InvoiceStatus })
  status!: InvoiceStatus;

  @ApiProperty()
  date!: string;

  @ApiProperty()
  total_gross!: string;
}
