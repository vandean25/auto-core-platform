import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateWorkshopOrderDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @IsInt()
  @Min(0)
  odometer: number;

  @IsInt()
  @Min(0)
  @Max(100)
  fuelLevel: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
