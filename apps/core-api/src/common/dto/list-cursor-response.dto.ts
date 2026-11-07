import { ApiProperty } from '@nestjs/swagger';

export class CappedListCountResponseDto {
  @ApiProperty({ minimum: 0, maximum: 1000 })
  count!: number;

  @ApiProperty()
  isCapped!: boolean;
}

export class ListCursorPageMetaDto {
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty()
  hasNextPage!: boolean;

  @ApiProperty({ minimum: 1 })
  limit!: number;
}
