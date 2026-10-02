import { ApiProperty } from '@nestjs/swagger';
import { TyreSetResponseDto } from './tyre-set.dto.js';

export class TyreSetListEnvelopeDto {
  @ApiProperty({ type: [TyreSetResponseDto] })
  data!: TyreSetResponseDto[];
}
