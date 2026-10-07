import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';
import { CustomerResponseDto } from '../../customer/dto/customer-response.dto.js';
import { DryRunMetaDto } from '../../dry-run/dto/dry-run-response.dto.js';
import { PickerlDueDto } from './pickerl-due.dto.js';

export class OpenPickerlOrderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order_number!: string;
}

export class VehicleResponseDto extends DryRunMetaDto {
  @ApiProperty({
    type: () => OpenPickerlOrderDto,
    required: false,
    nullable: true,
  })
  open_pickerl_order?: { id: string; order_number: string } | null;

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
    type: String,
    format: 'date',
    required: false,
    nullable: true,
  })
  first_registration_date?: string | Date | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  co2_wltp_g_km?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  co2_nedc_g_km?: number | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  typenschein_no?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  nova_class?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  emission_class?: string | null;

  @ApiProperty({
    type: () => CustomerResponseDto,
    required: false,
    nullable: true,
  })
  customer?: CustomerResponseDto | null;

  @ApiProperty({ type: () => PickerlDueDto, required: false })
  pickerl_due?: PickerlDueDto;
}

export class VehicleListItemDto extends VehicleResponseDto {}

export class VehiclePaginatedResponseDto {
  @ApiProperty({ type: [VehicleListItemDto] })
  data!: VehicleListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
