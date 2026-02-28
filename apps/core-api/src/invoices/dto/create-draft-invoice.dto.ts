import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateDraftInvoiceDto {
  @IsUUID()
  @IsNotEmpty()
  workshopOrderId: string;
}
