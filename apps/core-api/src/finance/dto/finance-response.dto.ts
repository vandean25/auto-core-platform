import { ApiProperty } from '@nestjs/swagger';

export class FinanceSettingsResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fiscal_year_start_month!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  lock_date!: Date | null;

  @ApiProperty()
  next_invoice_number!: number;

  @ApiProperty()
  invoice_prefix!: string;

  @ApiProperty()
  next_sales_order_number!: number;

  @ApiProperty()
  sales_order_prefix!: string;

  @ApiProperty()
  next_workshop_order_number!: number;

  @ApiProperty()
  workshop_order_prefix!: string;

  @ApiProperty()
  next_vehicle_purchase_number!: number;

  @ApiProperty()
  vehicle_purchase_prefix!: string;

  @ApiProperty()
  next_vehicle_sale_number!: number;

  @ApiProperty()
  vehicle_sale_prefix!: string;
}

export class RevenueGroupResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  tax_rate!: number;

  @ApiProperty()
  account_number!: string;

  @ApiProperty()
  is_default!: boolean;
}

export class RevenueAnalyticsSliceDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  value!: number;

  @ApiProperty()
  color!: string;
}

export class RevenueAnalyticsResponseDto {
  @ApiProperty({ type: [RevenueAnalyticsSliceDto] })
  data!: RevenueAnalyticsSliceDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  period!: string;
}
