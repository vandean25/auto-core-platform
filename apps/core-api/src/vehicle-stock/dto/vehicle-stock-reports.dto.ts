import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleInventoryRole, VehicleStockStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import type { VehicleStockAgeBucket } from '../vehicle-stock-reports.math.js';

export class VehicleStockAgeReportQueryDto {
  @ApiPropertyOptional({ enum: ['USED', 'NEW', 'DEMO'] })
  @IsOptional()
  @IsIn(['USED', 'NEW', 'DEMO'])
  inventory_role?: VehicleInventoryRole;

  @ApiPropertyOptional({ enum: ['IN_STOCK', 'RESERVED', 'IN_PREP'] })
  @IsOptional()
  @IsIn(['IN_STOCK', 'RESERVED', 'IN_PREP'])
  stock_status?: VehicleStockStatus;

  @ApiPropertyOptional({
    enum: ['0_30', '31_60', '61_90', '91_180', 'over_180', 'over_90'],
  })
  @IsOptional()
  @IsEnum({
    ZERO_TO_THIRTY: '0_30',
    THIRTY_ONE_TO_SIXTY: '31_60',
    SIXTY_ONE_TO_NINETY: '61_90',
    NINETY_ONE_TO_ONE_EIGHTY: '91_180',
    OVER_ONE_EIGHTY: 'over_180',
    OVER_NINETY: 'over_90',
  })
  bucket?: VehicleStockAgeBucket | 'over_90';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class VehicleStockMarginReportQueryDto {
  @ApiProperty({ format: 'date' })
  @IsDateString()
  from!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class VehicleStockReportPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() pageCount!: number;
}

export class VehicleStockAgeReportRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty({ type: String, nullable: true }) vin!: string | null;
  @ApiProperty({ type: String, nullable: true }) plate!: string | null;
  @ApiProperty({ enum: ['USED', 'NEW', 'DEMO'] })
  inventory_role!: VehicleInventoryRole;
  @ApiProperty({ enum: ['IN_STOCK', 'RESERVED', 'IN_PREP'], nullable: true })
  stock_status!: VehicleStockStatus | null;
  @ApiProperty({ type: Number, nullable: true }) days_in_stock!: number | null;
  @ApiProperty() missing_stock_in_date!: boolean;
  @ApiProperty({ type: String, nullable: true }) stock_in_date!: string | null;
  @ApiProperty({
    type: String,
    enum: ['0_30', '31_60', '61_90', '91_180', 'over_180'],
    nullable: true,
  })
  age_bucket!: VehicleStockAgeBucket | null;
  @ApiProperty() cost_basis!: string;
  @ApiProperty({ type: String, nullable: true }) asking_price!: string | null;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
}

export class VehicleStockMarginReportRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() sale_number!: string;
  @ApiProperty() vehicle_id!: string;
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty({ enum: ['USED', 'NEW', 'DEMO'] })
  inventory_role!: VehicleInventoryRole;
  @ApiProperty() invoice_date!: string;
  @ApiProperty() sale_price!: string;
  @ApiProperty({ type: String, nullable: true }) cost_basis_snapshot!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) gross_margin_eur!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) gross_margin_percent!:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) days_to_sell!: number | null;
  @ApiProperty() margin_taxed!: boolean;
}

export class VehicleStockAgeReportSummaryDto {
  @ApiProperty() over_90_count!: number;
  @ApiProperty() over_90_cost_basis!: string;
}

export class VehicleStockAgeReportResponseDto {
  @ApiProperty({ type: [VehicleStockAgeReportRowDto] })
  data!: VehicleStockAgeReportRowDto[];
  @ApiProperty({ type: VehicleStockReportPaginationMetaDto })
  meta!: VehicleStockReportPaginationMetaDto;
  @ApiProperty({ type: VehicleStockAgeReportSummaryDto })
  summary!: VehicleStockAgeReportSummaryDto;
}

export class VehicleStockMarginRoleTotalsDto {
  @ApiProperty() count!: number;
  @ApiProperty() gross_margin_total!: string;
  @ApiProperty({ type: String, nullable: true }) gross_margin_average!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) gross_margin_percent_average!:
    string | null;
  @ApiProperty() sale_price_total!: string;
  @ApiProperty({ type: String, nullable: true }) sale_price_average!:
    string | null;
  @ApiProperty() cost_basis_total!: string;
  @ApiProperty({ type: String, nullable: true }) cost_basis_average!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) days_to_sell_average!:
    string | null;
}

export class VehicleStockMarginReportTotalsDto {
  @ApiProperty() count!: number;
  @ApiProperty() gross_margin_total!: string;
  @ApiProperty({ type: String, nullable: true }) gross_margin_average!:
    string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      $ref: '#/components/schemas/VehicleStockMarginRoleTotalsDto',
    },
  })
  by_inventory_role!: Record<string, VehicleStockMarginRoleTotalsDto>;
}

export class VehicleStockMarginReportResponseDto {
  @ApiProperty({ type: [VehicleStockMarginReportRowDto] })
  data!: VehicleStockMarginReportRowDto[];
  @ApiProperty({ type: VehicleStockReportPaginationMetaDto })
  meta!: VehicleStockReportPaginationMetaDto;
  @ApiProperty({ type: VehicleStockMarginReportTotalsDto })
  totals!: VehicleStockMarginReportTotalsDto;
}
