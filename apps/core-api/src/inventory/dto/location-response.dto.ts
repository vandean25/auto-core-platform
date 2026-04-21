import { ApiProperty } from '@nestjs/swagger';
import { LocationType } from '@prisma/client';

export class LocationCountsDto {
  @ApiProperty()
  children!: number;

  @ApiProperty()
  stocks!: number;
}

export class LocationParentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: LocationType })
  type!: LocationType;

  @ApiProperty({ type: String, required: false, nullable: true })
  parent_id?: string | null;
}

export class LocationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: LocationType })
  type!: LocationType;

  @ApiProperty({ type: String, required: false, nullable: true })
  parent_id?: string | null;

  @ApiProperty({ required: false, type: () => LocationParentResponseDto })
  parent?: LocationParentResponseDto;

  @ApiProperty({ required: false, type: () => LocationCountsDto })
  _count?: LocationCountsDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class LocationTreeNodeDto extends LocationResponseDto {
  @ApiProperty({ type: () => [LocationTreeNodeDto] })
  children!: LocationTreeNodeDto[];
}
