import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MoveVehicleSiteDto {
  @ApiProperty()
  @IsUUID()
  toSiteId!: string;

  @ApiProperty()
  @IsUUID()
  toLocationId!: string;

  @ApiProperty()
  @IsUUID()
  expectedLocationId!: string;
}
