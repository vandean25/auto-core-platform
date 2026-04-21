import { ApiProperty } from '@nestjs/swagger';

export class BrandResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isVehicleMake!: boolean;

  @ApiProperty()
  isPartManufacturer!: boolean;

  @ApiProperty({ type: String, required: false, nullable: true })
  logoUrl?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
