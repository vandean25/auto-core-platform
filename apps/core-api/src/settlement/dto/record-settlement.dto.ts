import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class RecordSettlementDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  idempotencyKey!: string;

  @ApiProperty({ enum: ['CASH', 'CARD'] })
  @IsIn(['CASH', 'CARD'])
  method!: 'CASH' | 'CARD';

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  externalReceiptNumber?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== '')
  @IsDateString()
  externalReceiptDate?: string;
}

export class ReconcileSettlementDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  idempotencyKey!: string;
}

export class CancelFiscalReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  idempotencyKey!: string;
}
