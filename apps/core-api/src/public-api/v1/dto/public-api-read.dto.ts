import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Shared list query for every /api/public/v1 list endpoint. */
export class PublicListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Case-insensitive contains match on the entity’s identifying fields.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class PublicPageMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() pageCount!: number;
}

export class PublicAddressDto {
  @ApiPropertyOptional({ nullable: true, type: String }) street!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) zip!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) city!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) country!:
    string | null;
}

export class PublicCustomerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PRIVATE', 'COMPANY'] }) type!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) companyName!:
    string | null;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) email!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) vatId!: string | null;
  @ApiProperty({ type: PublicAddressDto }) address!: PublicAddressDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class PublicVehicleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiPropertyOptional({ nullable: true, type: String }) vin!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) plate!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) hsn!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) tsn!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) engineCode!:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) fuelType!:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) powerKw!:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) mileage!:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: String }) color!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date' })
  firstRegistrationDate!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  customerId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class PublicInvoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) invoiceNumber!:
    string | null;
  @ApiProperty() status!: string;
  @ApiProperty() taxMode!: string;
  @ApiProperty({ type: String, format: 'date-time' }) date!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) dueDate!: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) currency!:
    string | null;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  vehicleId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  workshopOrderId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  salesOrderId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  siteId!: string | null;
  @ApiProperty({
    example: '100.00',
    description: 'Decimal string, two places.',
  })
  totalNet!: string;
  @ApiProperty({ example: '20.00', description: 'Decimal string, two places.' })
  totalTax!: string;
  @ApiProperty({
    example: '120.00',
    description: 'Decimal string, two places.',
  })
  totalGross!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class PublicWorkshopOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty() purpose!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  siteId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  customerId!: string | null;
  @ApiProperty({ format: 'uuid' }) vehicleId!: string;
  @ApiProperty() odometer!: number;
  @ApiProperty() fuelLevel!: number;
  @ApiPropertyOptional({ nullable: true, type: String }) reportedIssue!:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  scheduledStartAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  scheduledEndAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class PublicStockLevelDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) catalogItemId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'uuid' }) siteId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty() locationCode!: string;
  @ApiProperty() locationName!: string;
  @ApiProperty({ example: '5.000' }) quantityOnHand!: string;
  @ApiProperty({ example: '1.500' }) quantityReserved!: string;
  @ApiProperty({ example: '3.500', description: 'On hand minus reserved.' })
  quantityAvailable!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
