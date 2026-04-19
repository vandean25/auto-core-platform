import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';

export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  @IsEnum(EmployeeRole)
  role!: EmployeeRole;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class ListEmployeesQueryDto {
  @ApiPropertyOptional({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @ApiPropertyOptional({
    default: false,
    description: 'Include inactive employees when true',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  includeInactive?: boolean;
}

export class EmployeeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  role!: EmployeeRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class EmployeesListMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class EmployeesListResponseDto {
  @ApiProperty({ type: [EmployeeResponseDto] })
  data!: EmployeeResponseDto[];

  @ApiProperty({ type: EmployeesListMetaDto })
  meta!: EmployeesListMetaDto;
}

export class EmployeeDeleteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  deleted?: boolean;
}
