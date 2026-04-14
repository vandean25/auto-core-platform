import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateWorkshopOrderDto {
  @IsUUID()
  @IsNotEmpty()
  customerId!: string;

  @IsUUID()
  @IsNotEmpty()
  vehicleId!: string;

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
