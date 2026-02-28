import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateDraftInvoiceDto } from './dto/create-draft-invoice.dto';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('drafts')
  createDraft(@Body() dto: CreateDraftInvoiceDto) {
    return this.invoicesService.createDraftInvoice(dto.workshopOrderId);
  }

  @Patch(':id/issue')
  issue(@Param('id') id: string) {
    return this.invoicesService.issueInvoice(id);
  }
}
