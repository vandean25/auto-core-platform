import { ApiProperty } from '@nestjs/swagger';
import { VehicleEquipmentAssertion } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto.js';

export class VehicleEquipmentOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ABS' })
  code!: string;

  @ApiProperty()
  label_de!: string;

  @ApiProperty()
  label_en!: string;

  @ApiProperty({ example: 'SAFETY' })
  category!: string;

  @ApiProperty()
  active!: boolean;
}

export class VehicleEquipmentOptionListResponseDto {
  @ApiProperty({ type: [VehicleEquipmentOptionDto] })
  data!: VehicleEquipmentOptionDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class PatchVehicleEquipmentOptionDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

export class VehicleEquipmentFreeTextItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty()
  sort_order!: number;
}

export class VehicleEquipmentSelectionDto {
  @ApiProperty({ type: VehicleEquipmentOptionDto })
  option!: VehicleEquipmentOptionDto;

  @ApiProperty({
    enum: VehicleEquipmentAssertion,
    enumName: 'VehicleEquipmentAssertion',
  })
  assertion!: VehicleEquipmentAssertion;
}

export class VehicleEquipmentAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  stock_purchase_id!: string;

  @ApiProperty({ type: [VehicleEquipmentSelectionDto] })
  selections!: VehicleEquipmentSelectionDto[];

  @ApiProperty({ type: [VehicleEquipmentFreeTextItemDto] })
  free_text_items!: VehicleEquipmentFreeTextItemDto[];
}

export class VehicleEquipmentSelectionWriteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  option_id!: string;

  @ApiProperty({
    enum: VehicleEquipmentAssertion,
    enumName: 'VehicleEquipmentAssertion',
  })
  @IsEnum(VehicleEquipmentAssertion)
  assertion!: VehicleEquipmentAssertion;
}

export class ReplaceVehicleEquipmentDto {
  @ApiProperty({ type: [VehicleEquipmentSelectionWriteDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((row: VehicleEquipmentSelectionWriteDto) => row.option_id)
  @ValidateNested({ each: true })
  @Type(() => VehicleEquipmentSelectionWriteDto)
  selections!: VehicleEquipmentSelectionWriteDto[];

  @ApiProperty({
    type: [String],
    description:
      'Free-text equipment lines for the current stock cycle (unknown options stay as plain text)',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  free_text_lines!: string[];
}
