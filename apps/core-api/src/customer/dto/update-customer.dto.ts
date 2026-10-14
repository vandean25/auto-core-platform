import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto.js';

// PartialType adds IsOptional to every field it inherits, and IsOptional skips null. The flag is declared here with
// its own rule instead, so a PATCH cannot send null into the NOT NULL column (ADR-0025 §8).
export class UpdateCustomerDto extends PartialType(
  OmitType(CreateCustomerDto, ['contact_email_ok'] as const),
) {
  @ApiPropertyOptional()
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsBoolean()
  contact_email_ok?: boolean;
}
