import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SEARCH_RESULT_TYPES, type SearchResultType } from '../search.types.js';

export class SearchResultDto {
  @ApiProperty({ enum: SEARCH_RESULT_TYPES })
  type!: SearchResultType;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  subtitle!: string | null;

  @ApiProperty({ description: 'App route that opens the entity.' })
  href!: string;

  @ApiProperty({
    description: '1 exact, 0.8 prefix, 0.5 contains.',
    minimum: 0,
    maximum: 1,
  })
  score!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Owning site for site-scoped types.',
  })
  siteId?: string;
}

export class SearchGroupDto {
  @ApiProperty({ enum: SEARCH_RESULT_TYPES })
  type!: SearchResultType;

  @ApiProperty({ type: [SearchResultDto] })
  results!: SearchResultDto[];

  @ApiPropertyOptional({
    enum: ['unavailable'],
    description: 'Set when this type failed; the other groups are still valid.',
  })
  error?: 'unavailable';
}

export class SearchResponseDto {
  @ApiProperty({ type: [SearchGroupDto] })
  groups!: SearchGroupDto[];
}
