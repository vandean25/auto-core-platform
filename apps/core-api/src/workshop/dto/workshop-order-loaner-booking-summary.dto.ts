import { ApiProperty } from '@nestjs/swagger';
import { LoanerBookingStatus } from '@prisma/client';

export class WorkshopOrderLoanerBookingSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: LoanerBookingStatus })
  status!: LoanerBookingStatus;

  @ApiProperty()
  plannedFrom!: Date;

  @ApiProperty()
  plannedTo!: Date;

  @ApiProperty()
  loanerVehicleId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  vehicleMake!: string | null;

  @ApiProperty({ type: String, nullable: true })
  vehicleModel!: string | null;

  @ApiProperty({ type: String, nullable: true })
  vehiclePlate!: string | null;
}
