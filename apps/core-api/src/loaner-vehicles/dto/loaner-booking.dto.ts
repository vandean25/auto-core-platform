import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanerBookingStatus } from '@prisma/client';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateLoanerBookingDto {
  @ApiProperty()
  @IsUUID()
  loanerVehicleId!: string;

  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workshopOrderId?: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  plannedFrom!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  plannedTo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  notes?: string;
}

export class UpdateLoanerBookingDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  plannedFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  plannedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workshopOrderId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  notes?: string | null;
}

export class HandOverLoanerBookingDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  odometerOut!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  fuelOut!: number;

  @ApiProperty()
  @IsBoolean()
  driverLicenceChecked!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  licenceCheckedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  damageNotesOut?: string;
}

export class ReturnLoanerBookingDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  odometerIn!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  fuelIn!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  damageNotesIn?: string;
}

export class LoanerOverdueQueryDto {
  @ApiPropertyOptional({
    description:
      'Evaluation timestamp for overdue detection (defaults to server now).',
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601()
  asOf?: string;
}

export class LoanerBookingCustomerSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  companyName!: string | null;
}

export class LoanerBookingVehicleSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  siteId!: string;
}

export class LoanerBookingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  loanerVehicleId!: string;

  @ApiProperty({ type: String, nullable: true })
  workshopOrderId!: string | null;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  plannedFrom!: Date;

  @ApiProperty()
  plannedTo!: Date;

  @ApiProperty({ enum: LoanerBookingStatus })
  status!: LoanerBookingStatus;

  @ApiProperty({ type: Date, nullable: true })
  handedOverAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  returnedAt!: Date | null;

  @ApiProperty({ type: Number, nullable: true })
  odometerOut!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  odometerIn!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fuelOut!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fuelIn!: number | null;

  @ApiProperty({ type: String, nullable: true })
  damageNotesOut!: string | null;

  @ApiProperty({ type: String, nullable: true })
  damageNotesIn!: string | null;

  @ApiProperty()
  driverLicenceChecked!: boolean;

  @ApiProperty({ type: String, nullable: true })
  licenceCheckedById!: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ type: () => LoanerBookingCustomerSummaryDto })
  customer?: LoanerBookingCustomerSummaryDto;

  @ApiPropertyOptional({ type: () => LoanerBookingVehicleSummaryDto })
  loanerVehicle?: LoanerBookingVehicleSummaryDto;
}

export class LoanerBookingListResponseDto {
  @ApiProperty({ type: [LoanerBookingResponseDto] })
  data!: LoanerBookingResponseDto[];
}
