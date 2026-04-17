import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PickWorkshopPartsLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workshopTaskLineItemId!: string;

  @ApiProperty({ example: 4, minimum: 0.001 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
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
