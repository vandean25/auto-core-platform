import { ApiProperty } from '@nestjs/swagger';

export class LegacyIdDto {
  @ApiProperty()
  source_system!: string;

  @ApiProperty()
  external_id!: string;
}
