import { ConflictException } from '@nestjs/common';
import { Prisma, StockTransferCommandAction } from '@prisma/client';
import {
  hashCommandRequest,
  redactStoredCommandResponse,
  SerializedStockTransfer,
} from './stock-transfer-serializer.js';

export interface StoredCommandReplay {
  command: {
    request_hash: string;
    response_body: Prisma.JsonValue;
  };
  requestBody: unknown;
  fromAccess: boolean;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export function serializedCommandBody(
  action: StockTransferCommandAction,
  requestBody: unknown,
  payload: { transfer: SerializedStockTransfer },
): Prisma.InputJsonValue {
  return {
    action,
    request: requestBody,
    ...payload,
  } as unknown as Prisma.InputJsonValue;
}

export function replayStoredCommand({
  command,
  requestBody,
  fromAccess,
}: StoredCommandReplay): SerializedStockTransfer {
  if (command.request_hash !== hashCommandRequest(requestBody)) {
    throw new ConflictException(
      'This idempotency key was already used with a different request body.',
    );
  }
  const stored = (command.response_body as Record<string, unknown>)
    .transfer as SerializedStockTransfer;
  return redactStoredCommandResponse(stored, fromAccess);
}
