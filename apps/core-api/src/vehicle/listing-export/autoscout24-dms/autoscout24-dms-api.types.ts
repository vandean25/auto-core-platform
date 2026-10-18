export type Autoscout24DmsListingPayload = {
  sellerListingRef: string;
  title: string | null;
  priceGrossEur: string | null;
  action: 'UPSERT' | 'DEACTIVATE';
};

export type Autoscout24DmsUpsertResult = {
  kind: 'upsert';
  externalListingId: string;
  httpStatus: number;
  idempotentReplay: boolean;
};

export type Autoscout24DmsDeactivateResult = {
  kind: 'deactivate';
  externalListingId: string | null;
  httpStatus: number;
  idempotentReplay: boolean;
};

export type Autoscout24DmsAdapterErrorCode =
  | 'client_error'
  | 'server_error'
  | 'rate_limit'
  | 'timeout'
  | 'network_error'
  | 'unconfigured';

export class Autoscout24DmsAdapterError extends Error {
  constructor(
    readonly code: Autoscout24DmsAdapterErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'Autoscout24DmsAdapterError';
  }
}

export type Autoscout24DmsCredentials = {
  clientId: string;
  clientSecret: string;
};
