import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export function bankMatchConflict(): ConflictException {
  return new ConflictException({
    code: 'BANK_RECONCILIATION_CONFLICT',
    message:
      'The transfer or invoice changed, or the allocation exceeds the available balance. Refresh and review the amounts.',
  });
}

export function assertBankVersion(current: number, expected: number) {
  if (current !== expected) throw bankMatchConflict();
}

export function assertAllBankInvoices(actual: number, expected: number) {
  if (actual !== expected) throw new NotFoundException();
}

export function invalidBankAllocation(): BadRequestException {
  return new BadRequestException();
}
