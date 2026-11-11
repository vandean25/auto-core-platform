import { ApiProperty } from '@nestjs/swagger';

export class ScopeContextHandshakeResponseDto {
  @ApiProperty({
    description:
      'Opaque HMAC-signed scope context token (X-ACP-Scope-Context).',
  })
  scopeContext!: string;

  @ApiProperty({
    description: 'SHA-256 digest of the scope context token for cache keys.',
  })
  scopeContextDigest!: string;

  @ApiProperty({
    description:
      'HMAC continuity digest for this sign-in lineage (subject + auth_time).',
  })
  continuityDigest!: string;
}
