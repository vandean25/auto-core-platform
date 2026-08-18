import { ApiProperty } from '@nestjs/swagger';
import { CustomerResponseDto } from '../../customer/dto/customer-response.dto';
import { VehicleResponseDto } from '../../vehicle/dto/vehicle-response.dto';

export class WorkshopSearchVehicleDto extends VehicleResponseDto {
  @ApiProperty({
    type: () => CustomerResponseDto,
    nullable: true,
  })
  customer!: CustomerResponseDto | null;
}

export class WorkshopSearchCustomerDto extends CustomerResponseDto {
  @ApiProperty({ type: [VehicleResponseDto] })
  vehicles!: VehicleResponseDto[];
}

export class WorkshopSearchDataDto {
  @ApiProperty({ type: [WorkshopSearchVehicleDto] })
  vehicles!: WorkshopSearchVehicleDto[];

  @ApiProperty({ type: [WorkshopSearchCustomerDto] })
  customers!: WorkshopSearchCustomerDto[];
}

export class WorkshopSearchMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class WorkshopSearchResponseDto {
  @ApiProperty({ type: WorkshopSearchDataDto })
  data!: WorkshopSearchDataDto;

  @ApiProperty({ type: WorkshopSearchMetaDto })
  meta!: WorkshopSearchMetaDto;
}
