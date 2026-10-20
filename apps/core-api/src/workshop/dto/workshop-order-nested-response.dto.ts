import { ApiProperty } from '@nestjs/swagger';
import {
  CustomerType,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { LoanerBookingStatus } from '@prisma/client';

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

  @ApiProperty()
  lineItemsVersion!: number;

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

export class WorkshopOrderLoanerBookingSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: LoanerBookingStatus })
  status!: LoanerBookingStatus;

  @ApiProperty()
  plannedFrom!: Date;

  @ApiProperty()
  plannedTo!: Date;

  @ApiProperty()
  loanerVehicleId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  vehicleMake!: string | null;

  @ApiProperty({ type: String, nullable: true })
  vehicleModel!: string | null;

  @ApiProperty({ type: String, nullable: true })
  vehiclePlate!: string | null;
}
