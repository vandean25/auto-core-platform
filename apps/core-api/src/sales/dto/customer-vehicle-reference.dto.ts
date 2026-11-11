import { ApiProperty } from '@nestjs/swagger';
import { CustomerResponseDto } from '../../customer/dto/customer-response.dto.js';
import { VehicleResponseDto } from '../../vehicle/dto/vehicle-response.dto.js';

/** Shared OpenAPI shape for document DTOs that embed customer + optional vehicle. */
export abstract class CustomerVehicleReferenceDto {
  @ApiProperty()
  customer_id!: string;

  @ApiProperty({ type: () => CustomerResponseDto })
  customer!: CustomerResponseDto;

  @ApiProperty({ type: String, required: false, nullable: true })
  vehicle_id?: string | null;

  @ApiProperty({
    type: () => VehicleResponseDto,
    required: false,
    nullable: true,
  })
  vehicle?: VehicleResponseDto | null;
}
