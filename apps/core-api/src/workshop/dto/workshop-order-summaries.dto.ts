import { ApiProperty } from '@nestjs/swagger';
import { CustomerType } from '@prisma/client';

export class WorkshopCustomerSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomerType })
  type!: CustomerType;

  @ApiProperty({ type: String, required: false, nullable: true })
  company_name?: string | null;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  email?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  phone?: string | null;
}

export class WorkshopVehicleSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  vin?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  plate?: string | null;
}

export class WorkshopInvoiceSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  invoice_number?: string | null;
}
