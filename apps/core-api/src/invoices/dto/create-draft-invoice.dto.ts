import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateDraftInvoiceDto {
  @ApiProperty({ example: 'workshop-order-id' })
  @IsUUID()
  @IsNotEmpty()
  workshopOrderId: string;
}
