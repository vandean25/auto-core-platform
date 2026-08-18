import { ApiProperty } from '@nestjs/swagger';
import { BrandResponseDto } from '../../brand/dto/brand-response.dto';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';

export class VendorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  account_number!: string;

  @ApiProperty({ type: [BrandResponseDto], required: false })
  supportedBrands?: BrandResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class VendorPaginatedResponseDto {
  @ApiProperty({ type: [VendorResponseDto] })
  data!: VendorResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
