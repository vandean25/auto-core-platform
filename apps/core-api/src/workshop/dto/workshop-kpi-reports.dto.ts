import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class WorkshopKpiReportQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  siteId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY_PATTERN)
  from!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY_PATTERN)
  to!: string;

  @ApiPropertyOptional({
    enum: ['mechanic', 'week', 'month'],
    default: 'mechanic',
  })
  @IsOptional()
  @IsIn(['mechanic', 'week', 'month'])
  groupBy: 'mechanic' | 'week' | 'month' = 'mechanic';
}

export class WorkshopKpiReportRowDto {
  @ApiProperty() key!: string;
  @ApiProperty({ type: String, nullable: true }) mechanic_id!: string | null;
  @ApiProperty({ type: String, nullable: true }) mechanic_name!: string | null;
  @ApiProperty() period!: string;
  @ApiProperty() available_hours!: string;
  @ApiProperty() clocked_hours!: string;
  @ApiProperty() sold_hours!: string;
  @ApiProperty() labor_net_revenue!: string;
  @ApiProperty() parts_net_revenue!: string;
  @ApiProperty({ type: String, nullable: true }) utilisation_percent!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) productivity_percent!:
    string | null;
  @ApiProperty() closed_orders!: number;
  @ApiProperty({ type: String, nullable: true })
  average_net_revenue_per_order!: string | null;
  @ApiProperty() open_labor_entry_count!: number;
}

export class WorkshopKpiSlowMoverDto {
  @ApiProperty() catalog_item_id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() quantity_on_hand!: string;
  @ApiProperty({ type: String, nullable: true }) stock_value!: string | null;
  @ApiProperty({ type: Number, nullable: true }) days_since_last_issue!:
    number | null;
}

export class WorkshopKpiPartsTurnoverDto {
  @ApiProperty() issued_cost!: string;
  @ApiProperty({ type: String, nullable: true }) average_stock_value!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) turnover!: string | null;
  @ApiProperty() unvalued_stock_item_count!: number;
  @ApiProperty({ type: [WorkshopKpiSlowMoverDto] })
  slow_movers!: WorkshopKpiSlowMoverDto[];
}

export class WorkshopKpiReportMetaDto {
  @ApiProperty({ format: 'date' }) from!: string;
  @ApiProperty({ format: 'date' }) to!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['mechanic', 'week', 'month'] }) groupBy!: string;
  @ApiProperty() unassigned_mechanic_count!: number;
}

export class WorkshopKpiReportResponseDto {
  @ApiProperty({ type: [WorkshopKpiReportRowDto] })
  data!: WorkshopKpiReportRowDto[];
  @ApiProperty({ type: WorkshopKpiReportMetaDto })
  meta!: WorkshopKpiReportMetaDto;
  @ApiProperty({ type: WorkshopKpiReportRowDto })
  totals!: WorkshopKpiReportRowDto;
  @ApiProperty({ type: WorkshopKpiPartsTurnoverDto })
  parts_turnover!: WorkshopKpiPartsTurnoverDto;
}
