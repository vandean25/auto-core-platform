import { ApiProperty } from '@nestjs/swagger';
import { CustomerType } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';

export class CustomerResponseDto {
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

  @ApiProperty({ type: String, required: false, nullable: true })
  vat_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_street?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_city?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_zip?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_country?: string | null;

  @ApiProperty({ required: false })
  createdAt?: Date;

  @ApiProperty({ required: false })
  updatedAt?: Date;
}

export class CustomerPaginatedResponseDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  data!: CustomerResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
