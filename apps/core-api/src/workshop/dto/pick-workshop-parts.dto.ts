import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PickWorkshopPartsLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workshopTaskLineItemId!: string;

  @ApiProperty({ example: 4, minimum: 1, type: 'integer' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;
}

export class PickWorkshopPartsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationLocationId!: string;

  @ApiProperty({
    type: () => [PickWorkshopPartsLineDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PickWorkshopPartsLineDto)
  items!: PickWorkshopPartsLineDto[];
}
