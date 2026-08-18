import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { CustomerResponseDto } from '../../customer/dto/customer-response.dto';

export class VehicleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  engine_code?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  vin?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  plate?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  customer_id?: string | null;
}

export class VehicleListItemDto extends VehicleResponseDto {
  @ApiProperty({
    type: () => CustomerResponseDto,
    required: false,
    nullable: true,
  })
  customer?: CustomerResponseDto | null;
}

export class VehiclePaginatedResponseDto {
  @ApiProperty({ type: [VehicleListItemDto] })
  data!: VehicleListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
