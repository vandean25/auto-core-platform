import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CustomerType,
  VehiclePartyRole,
  VehicleRecordSource,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateVehiclePartyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customer_id!: string;

  @ApiProperty({ enum: VehiclePartyRole, enumName: 'VehiclePartyRole' })
  @IsEnum(VehiclePartyRole)
  role!: VehiclePartyRole;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'valid_from must be YYYY-MM-DD' })
  valid_from?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'valid_to must be YYYY-MM-DD' })
  valid_to?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class EndVehiclePartyDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Exclusive end day. Defaults to today.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'valid_to must be YYYY-MM-DD' })
  valid_to?: string;
}

export class VehiclePartyCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomerType, enumName: 'CustomerType' })
  type!: CustomerType;

  @ApiProperty({ type: String, nullable: true })
  company_name!: string | null;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;
}

export class VehiclePartyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty()
  customer_id!: string;

  @ApiProperty({ enum: VehiclePartyRole, enumName: 'VehiclePartyRole' })
  role!: VehiclePartyRole;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  valid_from!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  valid_to!: string | null;

  @ApiProperty({
    enum: VehicleRecordSource,
    enumName: 'VehicleRecordSource',
  })
  source!: VehicleRecordSource;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ description: 'Active today, using the half-open interval.' })
  is_active!: boolean;

  @ApiProperty({ type: () => VehiclePartyCustomerDto })
  customer!: VehiclePartyCustomerDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class SuggestedBillToDto {
  @ApiProperty()
  customer_id!: string;

  @ApiProperty({ enum: ['BILL_TO', 'LEASING'] })
  role!: 'BILL_TO' | 'LEASING';

  @ApiProperty({ type: () => VehiclePartyCustomerDto })
  customer!: VehiclePartyCustomerDto;
}

export class VehiclePartiesResponseDto {
  @ApiProperty({
    type: [VehiclePartyResponseDto],
    description:
      'Every party of the vehicle, including ended ones and previous owners.',
  })
  data!: VehiclePartyResponseDto[];

  @ApiProperty({
    type: () => SuggestedBillToDto,
    nullable: true,
    description:
      'Read-only payer hint: active BILL_TO, else LEASING, else null. The owner is never a payer fallback.',
  })
  suggested_bill_to!: SuggestedBillToDto | null;
}

export class CustomerVehiclePartyVehicleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty({ type: String, nullable: true })
  plate!: string | null;
}

/** A vehicle party seen from the customer detail ("vehicles by role"). */
export class CustomerVehiclePartyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty({ enum: VehiclePartyRole, enumName: 'VehiclePartyRole' })
  role!: VehiclePartyRole;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  valid_from!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  valid_to!: string | null;

  @ApiProperty({ enum: VehicleRecordSource, enumName: 'VehicleRecordSource' })
  source!: VehicleRecordSource;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: () => CustomerVehiclePartyVehicleDto })
  vehicle!: CustomerVehiclePartyVehicleDto;
}

export class VehicleOpenDueDateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  due_date!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  due_mileage!: number | null;

  @ApiProperty({ type: String, nullable: true })
  external_ref!: string | null;

  @ApiProperty({ enum: VehicleRecordSource, enumName: 'VehicleRecordSource' })
  source!: VehicleRecordSource;
}
