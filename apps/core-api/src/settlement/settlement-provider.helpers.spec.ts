import { FiscalRegisterEnv } from '@prisma/client';
import { UnprocessableEntityException } from '@nestjs/common';
import { assertProductiveReceiptEnv } from './settlement-provider.helpers.js';

describe('assertProductiveReceiptEnv', () => {
  it('requires response _env to match the register env', () => {
    expect(() =>
      assertProductiveReceiptEnv(FiscalRegisterEnv.TEST, { _env: 'LIVE' }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertProductiveReceiptEnv(FiscalRegisterEnv.TEST, { _env: 'TEST' }),
    ).not.toThrow();
  });
});
