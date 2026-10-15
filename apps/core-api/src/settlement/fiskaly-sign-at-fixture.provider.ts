import { Injectable } from '@nestjs/common';
import type {
  FiskalySignAtProvider,
  FiskalySignAtProviderResult,
} from './fiskaly-sign-at.types.js';
import { FakeFiskalySignAtContractServer } from './fiskaly-sign-at-contract.server.js';

@Injectable()
export class FiskalySignAtFixtureProvider implements FiskalySignAtProvider {
  readonly contractServer = new FakeFiskalySignAtContractServer();

  signReceipt(params: {
    cashRegisterId: string;
    receiptId: string;
    body: Record<string, unknown>;
  }): Promise<FiskalySignAtProviderResult> {
    return this.contractServer.signReceipt(params.receiptId, params.body);
  }

  retrieveReceipt(params: {
    cashRegisterId: string;
    receiptId: string;
  }): Promise<FiskalySignAtProviderResult> {
    return this.contractServer.retrieveReceipt(params.receiptId);
  }
}
