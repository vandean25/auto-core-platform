import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleListingPlatform } from '@prisma/client';

export class VehicleListingExportFieldIssueDto {
  @ApiProperty({ example: 'price_gross_eur' })
  field!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional()
  code?: string;
}

export class VehicleListingChannelValidationDto {
  @ApiProperty({
    enum: VehicleListingPlatform,
    enumName: 'VehicleListingPlatform',
  })
  platform!: VehicleListingPlatform;

  @ApiProperty()
  serializer_profile!: string;

  @ApiProperty({
    description:
      'False when no export serializer is registered for this channel profile.',
  })
  serializer_supported!: boolean;

  @ApiProperty({ type: [VehicleListingExportFieldIssueDto] })
  issues!: VehicleListingExportFieldIssueDto[];
}

export class VehicleListingExportValidationResponseDto {
  @ApiProperty({ type: [VehicleListingChannelValidationDto] })
  channels!: VehicleListingChannelValidationDto[];
}
