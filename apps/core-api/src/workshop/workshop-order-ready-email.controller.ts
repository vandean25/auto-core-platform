import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { WorkshopReadyEmailNoticeDto } from './dto/workshop-ready-email-notice.dto.js';
import { WorkshopOrderReadyEmailService } from './workshop-order-ready-email.service.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrderReadyEmailController {
  constructor(private readonly readyEmail: WorkshopOrderReadyEmailService) {}

  /** Advisor resend of the ready-for-pickup email (AUT-357). Each call is a new audited occurrence. */
  @Post('orders/:id/ready-email/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkshopReadyEmailNoticeDto })
  resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.readyEmail.resend(id);
  }
}
