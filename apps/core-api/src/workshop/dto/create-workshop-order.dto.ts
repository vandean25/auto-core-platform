import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
  IsEnum,
  ValidateIf,
} from 'class-validator';
import { WorkshopOrderPurpose } from '@prisma/client';

export class CreateWorkshopOrderDto {
  @ValidateIf((dto: CreateWorkshopOrderDto) => dto.purpose !== WorkshopOrderPurpose.STOCK_PREP)
  @IsUUID()
  @IsNotEmpty()
  customerId?: string;

  @IsUUID()
  @IsNotEmpty()
  vehicleId!: string;

  @IsOptional()
  @IsEnum(WorkshopOrderPurpose)
  purpose?: WorkshopOrderPurpose;

  @IsInt()
  @Min(0)
  odometer!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  fuelLevel!: number;

  @IsString()
  @IsOptional()
  reportedIssue?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
