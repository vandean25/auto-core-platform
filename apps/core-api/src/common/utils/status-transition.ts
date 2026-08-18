import { ConflictException } from '@nestjs/common';

export const STALE_STATUS_CONFLICT_MESSAGE =
  'Record was already transitioned by another request';

export type StatusUpdateMany = (args: {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}) => Promise<{ count: number }>;

export type GuardedStatusUpdateInput = {
  id: string;
  tenantId: string;
  from: unknown;
  to: unknown;
  extraWhere?: object;
  extraData?: object;
  conflictMessage?: string;
};

export async function guardedStatusUpdate(
  updateMany: StatusUpdateMany,
  input: GuardedStatusUpdateInput,
): Promise<void> {
  const result = await updateMany({
    where: {
      ...input.extraWhere,
      id: input.id,
      tenant_id: input.tenantId,
      status: input.from,
    },
    data: {
      ...input.extraData,
      status: input.to,
    },
  });

  if (result.count === 0) {
    throw new ConflictException(
      input.conflictMessage ?? STALE_STATUS_CONFLICT_MESSAGE,
    );
  }
}

export function bindStatusUpdateMany(model: {
  updateMany: (args: never) => Promise<{ count: number }>;
}): StatusUpdateMany {
  return (args) => model.updateMany(args as never);
}
