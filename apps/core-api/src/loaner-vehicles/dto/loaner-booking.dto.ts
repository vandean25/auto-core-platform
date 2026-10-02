import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
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

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  plannedFrom!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  plannedTo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  notes?: string;
}

export class UpdateLoanerBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  plannedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  asOf?: string;
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
}

export class LoanerBookingListResponseDto {
  @ApiProperty({ type: [LoanerBookingResponseDto] })
  data!: LoanerBookingResponseDto[];
}
