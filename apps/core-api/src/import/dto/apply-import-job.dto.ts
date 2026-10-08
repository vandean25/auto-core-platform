import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class ApplyImportJobDto {
  @ApiPropertyOptional({
    description: 'Accept all price changes exceeding the threshold',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  accept_all_price_jumps?: boolean;

  @ApiPropertyOptional({
    description: 'Specific row numbers where price jumps are accepted',
    type: [Number],
    example: [1, 2, 5],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  accepted_row_numbers?: number[];
}
