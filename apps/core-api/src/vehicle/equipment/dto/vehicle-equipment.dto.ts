import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

export class VehicleEquipmentFreeTextItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty()
  sort_order!: number;
}

export class VehicleEquipmentAssignmentDto {
  @ApiProperty({ type: [VehicleEquipmentOptionDto] })
  options!: VehicleEquipmentOptionDto[];

  @ApiProperty({ type: [VehicleEquipmentFreeTextItemDto] })
  free_text_items!: VehicleEquipmentFreeTextItemDto[];
}

export class ReplaceVehicleEquipmentDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'VehicleEquipmentOption ids for this tenant',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  option_ids?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Free-text equipment lines (unknown options stay as plain text)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  free_text_lines?: string[];
}
