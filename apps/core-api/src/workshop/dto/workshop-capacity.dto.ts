import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export type WorkshopCapacityOrderStatus =
  'SCHEDULED' | 'INTAKE' | 'IN_PROGRESS';

export class WorkshopCapacityQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-10-12',
    description:
      'Any date in the wanted week; the server snaps it to that ISO week Monday. Defaults to the week containing today in the site timezone.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must be YYYY-MM-DD' })
  weekStart?: string;
}

export class WorkshopCapacityOrderDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: ['SCHEDULED', 'INTAKE', 'IN_PROGRESS'] })
  status!: WorkshopCapacityOrderStatus;

  @ApiProperty({ enum: ['BOOKING', 'UNSCHEDULED_ON_FLOOR'] })
  occupancyKind!: 'BOOKING' | 'UNSCHEDULED_ON_FLOOR';

  @ApiPropertyOptional({ type: String, nullable: true })
  plate!: string | null;

  @ApiProperty({
    example: 2.5,
    description: 'Sum of LABOR line quantities (hours).',
  })
  plannedLaborHours!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  scheduledStartAt!: string | null;
}

export class WorkshopCapacityDayDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-12' })
  date!: string;

  @ApiProperty()
  isClosed!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: '07:30' })
  openTime!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '17:00' })
  closeTime!: string | null;

  @ApiProperty({ example: 9.5 })
  capacityHours!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  holidayName!: string | null;
}

export class WorkshopCapacityCellDto {
  @ApiProperty({ type: String, format: 'date' })
  date!: string;

  @ApiProperty({ example: 9.5 })
  capacityHours!: number;

  @ApiProperty({ example: 6.5 })
  bookedHours!: number;

  @ApiProperty({ example: 3 })
  freeHours!: number;

  @ApiProperty({ description: 'True when booked hours exceed capacity.' })
  isOverbooked!: boolean;

  @ApiProperty({ type: [WorkshopCapacityOrderDto] })
  orders!: WorkshopCapacityOrderDto[];
}

export class WorkshopCapacityBayDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: [WorkshopCapacityCellDto] })
  days!: WorkshopCapacityCellDto[];
}

export class WorkshopCapacityWeekDto {
  @ApiProperty()
  timezone!: string;

  @ApiProperty({ type: String, format: 'date' })
  today!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Monday of the week.',
  })
  weekStart!: string;

  @ApiProperty({ type: [WorkshopCapacityDayDto] })
  days!: WorkshopCapacityDayDto[];

  @ApiProperty({ type: [WorkshopCapacityBayDto] })
  bays!: WorkshopCapacityBayDto[];
}
