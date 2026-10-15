export type FiskalySignAtProviderResult =
  | {
      kind: 'http';
      status: number;
      body: Record<string, unknown> | null;
      requestId?: string;
    }
  | {
      kind: 'transport';
      transport: 'timeout' | 'connection_lost';
    };

export interface FiskalySignAtProvider {
  signReceipt(params: {
    cashRegisterId: string;
    receiptId: string;
    body: Record<string, unknown>;
  }): Promise<FiskalySignAtProviderResult>;

  retrieveReceipt(params: {
    cashRegisterId: string;
    receiptId: string;
  }): Promise<FiskalySignAtProviderResult>;
}

export const FISKALY_SIGN_AT_PROVIDER = Symbol('FISKALY_SIGN_AT_PROVIDER');
