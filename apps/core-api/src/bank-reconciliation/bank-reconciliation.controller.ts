import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BankStatementImportResponseDto,
  ListBankTransactionsQueryDto,
  ListBankTransactionsResponseDto,
} from './bank-reconciliation.dto.js';
import { BankReconciliationEnabledGuard } from './bank-reconciliation.guard.js';
import { BankReconciliationService } from './bank-reconciliation.service.js';

const MAX_STATEMENT_UPLOAD_BYTES = 10 * 1024 * 1024;

@ApiTags('bank-reconciliation')
@Controller('bank-reconciliation')
@UseGuards(BankReconciliationEnabledGuard)
export class BankReconciliationController {
  constructor(private readonly bankReconciliation: BankReconciliationService) {}

  @Post('imports')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_STATEMENT_UPLOAD_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: BankStatementImportResponseDto })
  importStatement(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<BankStatementImportResponseDto> {
    return this.bankReconciliation.importStatement(file);
  }

  @Get('transactions')
  @ApiOkResponse({ type: ListBankTransactionsResponseDto })
  listTransactions(
    @Query() query: ListBankTransactionsQueryDto,
  ): Promise<ListBankTransactionsResponseDto> {
    return this.bankReconciliation.listTransactions(query);
  }
}
