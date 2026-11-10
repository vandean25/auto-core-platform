import { ApiProperty } from '@nestjs/swagger';

export class CappedListCountResponseDto {
  @ApiProperty({ minimum: 0, maximum: 1000 })
  count!: number;

  @ApiProperty()
  isCapped!: boolean;

  @ApiProperty({
    required: false,
    description:
      'Echoed SHA-256 digest of a valid X-ACP-Scope-Context header (ADR-0038 §8).',
  })
  scopeContextDigest?: string;
}

export class ListCursorPageMetaDto {
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty()
  hasNextPage!: boolean;

  @ApiProperty({ minimum: 1 })
  limit!: number;

  @ApiProperty({
    required: false,
    description:
      'Echoed SHA-256 digest of a valid X-ACP-Scope-Context header (ADR-0038 §8).',
  })
  scopeContextDigest?: string;
}
