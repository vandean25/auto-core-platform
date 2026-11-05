import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CappedListCountResponseDto {
  @ApiProperty({ minimum: 0, maximum: 1000 })
  count!: number;

  @ApiProperty()
  isCapped!: boolean;
}

export class ListCursorMetaDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque cursor for the next page, or null when exhausted',
  })
  nextCursor!: string | null;

  @ApiProperty()
  hasNextPage!: boolean;

  @ApiProperty()
  limit!: number;
}
