import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { BankAllocationService } from './bank-allocation.service.js';
import {
  BankSuggestionsDto,
  BankTransactionActionDto,
  ConfirmBankTransactionDto,
  IgnoreBankTransactionDto,
  UndoBankTransactionDto,
} from './bank-matching.dto.js';
import { BankSuggestionsService } from './bank-suggestions.service.js';
import { BankReconciliationEnabledGuard } from './bank-reconciliation.guard.js';
import { BankReconciliationService } from './bank-reconciliation.service.js';

const MAX_STATEMENT_UPLOAD_BYTES = 10 * 1024 * 1024;

@ApiTags('bank-reconciliation')
@Controller('bank-reconciliation')
@UseGuards(BankReconciliationEnabledGuard)
export class BankReconciliationController {
  constructor(
    private readonly bankReconciliation: BankReconciliationService,
    private readonly suggestions: BankSuggestionsService,
    private readonly allocations: BankAllocationService,
  ) {}

  @Get('transactions/:id/suggestions')
  @ApiOkResponse({ type: BankSuggestionsDto })
  listSuggestions(@Param('id') id: string): Promise<BankSuggestionsDto> {
    return this.suggestions.list(id);
  }

  @Post('transactions/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BankTransactionActionDto })
  confirm(@Param('id') id: string, @Body() dto: ConfirmBankTransactionDto) {
    return this.allocations.confirm(id, dto);
  }

  @Post('transactions/:id/undo')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BankTransactionActionDto })
  undo(@Param('id') id: string, @Body() dto: UndoBankTransactionDto) {
    return this.allocations.undo(id, dto);
  }

  @Post('transactions/:id/ignore')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BankTransactionActionDto })
  ignore(@Param('id') id: string, @Body() dto: IgnoreBankTransactionDto) {
    return this.allocations.ignore(id, dto);
  }

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
