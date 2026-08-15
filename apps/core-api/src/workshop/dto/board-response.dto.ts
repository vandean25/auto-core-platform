import { ApiProperty } from '@nestjs/swagger';
import {
  CustomerType,
  EmployeeRole,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';

// ─── Resources Endpoint DTOs ─────────────────────────────────────────────────

export class WorkshopMechanicDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: EmployeeRole })
  role!: EmployeeRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;
}

export class WorkshopBayDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;
}

export class WorkshopResourcesResponseDto {
  @ApiProperty({ type: [WorkshopMechanicDto] })
  mechanics!: WorkshopMechanicDto[];

  @ApiProperty({ type: [WorkshopBayDto] })
  bays!: WorkshopBayDto[];
}

// ─── Board Active Endpoint DTOs ───────────────────────────────────────────────

export enum PartsStatus {
  READY = 'READY',
  SHORTAGE = 'SHORTAGE',
  WAITING = 'WAITING',
  NO_PARTS = 'NO_PARTS',
}

export class BoardLineItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: WorkshopLineItemType })
  type!: WorkshopLineItemType;

  @ApiProperty()
  itemNo!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({
    enum: WorkshopPartLineExecutionStatus,
    required: false,
    nullable: true,
  })
  partExecutionStatus?: WorkshopPartLineExecutionStatus | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  catalogItemId?: string | null;
}

export class BoardTaskDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: WorkshopTaskStatus })
  status!: WorkshopTaskStatus;

  @ApiProperty({ type: [BoardLineItemDto] })
  lineItems!: BoardLineItemDto[];
}

export class BoardCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomerType })
  type!: CustomerType;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true, required: false })
  companyName?: string | null;
}

export class BoardVehicleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String, nullable: true, required: false })
  plate?: string | null;
}

export class BoardOrderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: WorkshopOrderStatus })
  status!: WorkshopOrderStatus;

  @ApiProperty({ type: () => BoardCustomerDto, required: false, nullable: true })
  customer?: BoardCustomerDto | null;

  @ApiProperty({ type: () => BoardVehicleDto })
  vehicle!: BoardVehicleDto;

  @ApiProperty({ type: String, nullable: true, required: false })
  mechanicId?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  bayId?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  stagingLocationId?: string | null;

  @ApiProperty({ enum: PartsStatus })
  partsStatus!: PartsStatus;

  @ApiProperty({ type: [BoardTaskDto] })
  tasks!: BoardTaskDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class BoardActiveResponseDto {
  @ApiProperty({ type: [BoardOrderDto] })
  data!: BoardOrderDto[];
}
