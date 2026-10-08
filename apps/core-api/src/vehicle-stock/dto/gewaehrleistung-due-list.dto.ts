import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';

export class GewaehrleistungDueListQueryDto {
  @ApiProperty({ enum: [30, 60, 90], required: true })
  @Type(() => Number)
  @IsInt()
  @IsIn([30, 60, 90])
  endsWithinDays!: 30 | 60 | 90;
}

export class GewaehrleistungDueVehicleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  make!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String, nullable: true })
  vin!: string | null;

  @ApiProperty({ type: String, nullable: true })
  plate!: string | null;
}

export class GewaehrleistungDueCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  first_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  last_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  company_name!: string | null;
}

export class GewaehrleistungDueListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sale_number!: string;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty()
  customer_id!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  handed_over_at!: Date | null;

  @ApiProperty({ type: String, format: 'date' })
  gewaehrleistung_ends_on!: Date;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  presumption_ends_on!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  gewaehrleistung_rule_version!: string | null;

  @ApiProperty({ type: () => GewaehrleistungDueVehicleDto })
  vehicle!: GewaehrleistungDueVehicleDto;

  @ApiProperty({ type: () => GewaehrleistungDueCustomerDto })
  customer!: GewaehrleistungDueCustomerDto;
}

export class GewaehrleistungDueListResponseDto {
  @ApiProperty({ type: [GewaehrleistungDueListItemDto] })
  data!: GewaehrleistungDueListItemDto[];

  @ApiProperty()
  meta!: PaginationMetaDto;
}
