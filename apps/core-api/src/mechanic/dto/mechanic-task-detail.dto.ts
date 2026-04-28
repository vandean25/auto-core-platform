import { ApiProperty } from '@nestjs/swagger';
import {
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';

export class MechanicTaskVehicleDto {
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

export class MechanicTaskBayDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class MechanicTaskLineItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: WorkshopLineItemType })
  type!: WorkshopLineItemType;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  qty!: number;

  @ApiProperty({
    enum: WorkshopPartLineExecutionStatus,
    required: false,
    nullable: true,
  })
  partExecutionStatus?: WorkshopPartLineExecutionStatus | null;
}

export class MechanicTaskDetailDto {
  @ApiProperty()
  taskId!: string;

  @ApiProperty()
  taskTitle!: string;

  @ApiProperty({ enum: WorkshopTaskStatus })
  taskStatus!: WorkshopTaskStatus;

  @ApiProperty({ type: String, required: false, nullable: true })
  mechanicNotes?: string | null;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  reportedComplaint?: string | null;

  @ApiProperty()
  odometer!: number;

  @ApiProperty({ type: () => MechanicTaskVehicleDto })
  vehicle!: MechanicTaskVehicleDto;

  @ApiProperty({
    type: () => MechanicTaskBayDto,
    required: false,
    nullable: true,
  })
  bay?: MechanicTaskBayDto | null;

  @ApiProperty()
  sequence!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  scheduledDate?: string | null;

  @ApiProperty({ type: [MechanicTaskLineItemDto] })
  lineItems!: MechanicTaskLineItemDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
