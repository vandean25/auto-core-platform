import { ApiProperty } from '@nestjs/swagger';
import {
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';

export class MechanicVehicleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  plate?: string | null;
}

export class MechanicBayDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class MechanicPartLineDto {
  @ApiProperty()
  id!: string;

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

export class MechanicQueueItemDto {
  @ApiProperty()
  taskId!: string;

  @ApiProperty()
  taskTitle!: string;

  @ApiProperty({ enum: WorkshopTaskStatus })
  taskStatus!: WorkshopTaskStatus;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  reportedComplaint?: string | null;

  @ApiProperty({ type: () => MechanicVehicleDto })
  vehicle!: MechanicVehicleDto;

  @ApiProperty({ type: () => MechanicBayDto, required: false, nullable: true })
  bay?: MechanicBayDto | null;

  @ApiProperty()
  sequence!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  scheduledDate?: string | null;

  @ApiProperty({ type: [MechanicPartLineDto] })
  partLines!: MechanicPartLineDto[];

  @ApiProperty()
  updatedAt!: Date;
}

export class MechanicQueueResponseDto {
  @ApiProperty({ type: [MechanicQueueItemDto] })
  data!: MechanicQueueItemDto[];
}
