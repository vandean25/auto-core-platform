import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkshopOrderStatus } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { WorkshopOpeningHourDto } from './workshop-settings.dto';

export class PlannerRangeDto {
  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;
}

export class PlannerBayDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class PlannerHolidayDto {
  @ApiProperty({ example: '2026-10-26' })
  date!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isClosed!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  openTime!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  closeTime!: string | null;
}

export class PlannerCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;
}

export class PlannerVehicleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiPropertyOptional()
  plate?: string;
}

export class PlannerBookingDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: WorkshopOrderStatus })
  status!: 'SCHEDULED' | 'INTAKE' | 'IN_PROGRESS';

  @ApiProperty({ enum: ['BOOKING', 'UNSCHEDULED_ON_FLOOR'] })
  occupancyKind!: 'BOOKING' | 'UNSCHEDULED_ON_FLOOR';

  @ApiProperty()
  bayId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  mechanicId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  mechanicName!: string | null;

  @ApiProperty()
  scheduledStartAt!: string;

  @ApiProperty()
  scheduledEndAt!: string;

  @ApiPropertyOptional({ type: PlannerCustomerDto, nullable: true })
  customer!: PlannerCustomerDto | null;

  @ApiProperty({ type: PlannerVehicleDto })
  vehicle!: PlannerVehicleDto;
}

export class PlannerGridResponseDto {
  @ApiProperty()
  timezone!: string;

  @ApiProperty()
  slotMinutes!: number;

  @ApiProperty({ type: PlannerRangeDto })
  range!: PlannerRangeDto;

  @ApiProperty({ type: [PlannerBayDto] })
  bays!: PlannerBayDto[];

  @ApiProperty({ type: [WorkshopOpeningHourDto] })
  openings!: WorkshopOpeningHourDto[];

  @ApiProperty({ type: [PlannerHolidayDto] })
  holidays!: PlannerHolidayDto[];

  @ApiProperty({ type: [PlannerBookingDto] })
  bookings!: PlannerBookingDto[];
}

export class PlannerQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bayId?: string;
}
