import { ApiProperty } from '@nestjs/swagger';

export class CappedListCountResponseDto {
  @ApiProperty({ minimum: 0, maximum: 1000 })
  count!: number;

  @ApiProperty()
  isCapped!: boolean;
}
