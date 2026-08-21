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
import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';

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

  @ApiPropertyOptional({
    enum: [WorkshopOrderStatus.SCHEDULED, WorkshopOrderStatus.INTAKE],
    enumName: 'WorkshopOrderStatus',
  })
  @IsOptional()
  @IsEnum(WorkshopOrderStatus)
  status?: WorkshopOrderStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bayId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @IsOptional()
  @IsUUID()
  mechanicId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledStartAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledEndAt?: string;

  @ApiPropertyOptional()
  @ValidateIf(
    (dto: CreateWorkshopOrderDto) =>
      dto.status !== WorkshopOrderStatus.SCHEDULED,
  )
  @IsInt()
  @Min(0)
  odometer?: number;

  @ApiPropertyOptional()
  @ValidateIf(
    (dto: CreateWorkshopOrderDto) =>
      dto.status !== WorkshopOrderStatus.SCHEDULED,
  )
  @IsInt()
  @Min(0)
  @Max(100)
  fuelLevel?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reportedIssue?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
