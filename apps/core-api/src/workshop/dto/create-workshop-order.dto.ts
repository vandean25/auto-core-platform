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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkshopOrderPurpose } from '@prisma/client';

export class CreateWorkshopOrderDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(
    (dto: CreateWorkshopOrderDto) =>
      dto.purpose !== WorkshopOrderPurpose.STOCK_PREP,
  )
  @IsUUID()
  @IsNotEmpty()
  customerId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  vehicleId!: string;

  @ApiPropertyOptional({
    enum: WorkshopOrderPurpose,
    enumName: 'WorkshopOrderPurpose',
  })
  @IsOptional()
  @IsEnum(WorkshopOrderPurpose)
  purpose?: WorkshopOrderPurpose;

  @ApiProperty()
  @IsInt()
  @Min(0)
  odometer!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100)
  fuelLevel!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reportedIssue?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
