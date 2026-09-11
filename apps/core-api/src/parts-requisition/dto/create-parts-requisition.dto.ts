import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PartsRequisitionItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workshopTaskLineItemId!: string;

  @ApiProperty({
    example: 1.5,
    minimum: 0.001,
    multipleOf: 0.001,
    type: 'number',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
}

export class CreatePartsRequisitionDto {
  @ApiProperty({
    description: 'Vehicle-make Brand the sheet is raised for.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  vehicleMakeBrandId!: number;

  @ApiProperty({ type: [PartsRequisitionItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PartsRequisitionItemDto)
  items!: PartsRequisitionItemDto[];
}
