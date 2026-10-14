import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SendWorkshopEstimateVersionDto {
  /**
   * Also email the estimate link to the customer. The customer must be confirmed for order communication and have
   * an email address. Leave it off for an advisor-recorded send.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyCustomerByEmail?: boolean;
}
