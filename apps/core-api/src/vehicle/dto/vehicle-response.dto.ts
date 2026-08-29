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

  @ApiProperty({ type: Number, required: false, nullable: true })
  make_brand_id?: number | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  hsn?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  tsn?: string | null;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    required: false,
    nullable: true,
  })
  identity_keys?: Record<string, unknown> | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  identity_input_fingerprint?: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    required: false,
    nullable: true,
  })
  identity_resolved_at?: Date | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  fuel_type?: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  power_kw?: number | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  customer_id?: string | null;

  @ApiProperty({
    type: () => CustomerResponseDto,
    required: false,
    nullable: true,
  })
  customer?: CustomerResponseDto | null;
}

export class VehicleListItemDto extends VehicleResponseDto {}

export class VehiclePaginatedResponseDto {
  @ApiProperty({ type: [VehicleListItemDto] })
  data!: VehicleListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
