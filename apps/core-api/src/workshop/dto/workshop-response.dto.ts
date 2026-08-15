import { ApiProperty } from '@nestjs/swagger';
import {
  CustomerType,
  WorkshopLineItemType,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';

export class WorkshopCustomerSummaryDto {
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
}

export class WorkshopVehicleSummaryDto {
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

export class WorkshopInvoiceSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  invoice_number?: string | null;
}

export class WorkshopTaskLineItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: WorkshopLineItemType })
  type!: WorkshopLineItemType;

  @ApiProperty()
  itemNo!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  qty!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({
    enum: WorkshopPartLineExecutionStatus,
    required: false,
    nullable: true,
  })
  partExecutionStatus?: WorkshopPartLineExecutionStatus | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  laborOperationId?: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  standardAw?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  actualHours?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  internalCostRate?: number | null;
}

export class WorkshopTaskResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: WorkshopTaskStatus })
  status!: WorkshopTaskStatus;

  @ApiProperty({ type: String, required: false, nullable: true })
  mechanic_notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  mechanicNotes?: string | null;

  @ApiProperty()
  done!: boolean;

  @ApiProperty({ type: [WorkshopTaskLineItemResponseDto], required: false })
  line_items?: WorkshopTaskLineItemResponseDto[];

  @ApiProperty({ type: [WorkshopTaskLineItemResponseDto] })
  lineItems!: WorkshopTaskLineItemResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class WorkshopOrderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order_number!: string;

  @ApiProperty({ enum: WorkshopOrderStatus })
  status!: WorkshopOrderStatus;

  @ApiProperty({ enum: WorkshopOrderPurpose })
  purpose!: WorkshopOrderPurpose;

  @ApiProperty({ type: String, required: false, nullable: true })
  customer_id?: string | null;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty()
  odometer!: number;

  @ApiProperty()
  fuel_level!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  reported_issue?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  reportedIssue?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  staging_location_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  stagingLocationId?: string | null;

  @ApiProperty({ type: () => WorkshopCustomerSummaryDto, required: false, nullable: true })
  customer?: WorkshopCustomerSummaryDto | null;

  @ApiProperty({ type: () => WorkshopVehicleSummaryDto })
  vehicle!: WorkshopVehicleSummaryDto;

  @ApiProperty({ type: [WorkshopTaskResponseDto] })
  tasks!: WorkshopTaskResponseDto[];

  @ApiProperty({ required: false, type: () => WorkshopInvoiceSummaryDto })
  invoice?: WorkshopInvoiceSummaryDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class WorkshopPaginatedResponseDto {
  @ApiProperty({ type: [WorkshopOrderResponseDto] })
  data!: WorkshopOrderResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
