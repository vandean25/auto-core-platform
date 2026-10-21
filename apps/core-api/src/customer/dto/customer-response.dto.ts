import { ApiProperty } from '@nestjs/swagger';
import { CustomerType, DisplayLanguage } from '@prisma/client';
import { DryRunMetaDto } from '../../dry-run/dto/dry-run-response.dto.js';

export class CustomerResponseDto extends DryRunMetaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomerType })
  type!: CustomerType;

  @ApiProperty({ type: String, required: false, nullable: true })
  company_name?: string | null;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  email?: string | null;

  @ApiProperty({ type: Boolean, required: false })
  contact_email_ok?: boolean;

  @ApiProperty({ type: String, required: false, nullable: true })
  phone?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  vat_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_street?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_city?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_zip?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  address_country?: string | null;

  @ApiProperty({
    enum: DisplayLanguage,
    enumName: 'DisplayLanguage',
    required: false,
    nullable: true,
  })
  preferred_language?: DisplayLanguage | null;

  @ApiProperty({ required: false })
  createdAt?: Date;

  @ApiProperty({ required: false })
  updatedAt?: Date;
}
