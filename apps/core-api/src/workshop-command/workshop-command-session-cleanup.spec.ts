import type { Prisma } from '@prisma/client';
import { deleteCommandReplays } from './workshop-command-session-cleanup.js';

function createClient() {
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const client = {
    workshopCommandSession: { deleteMany },
  } as unknown as Prisma.TransactionClient;
  return { client, deleteMany };
}

describe('deleteCommandReplays', () => {
  it('deletes the replay rows of a decided command inside its own tenant', async () => {
    const { client, deleteMany } = createClient();

    await deleteCommandReplays(client, 'tenant-a', ['command-1']);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-a', command_id: { in: ['command-1'] } },
    });
  });

  it('skips the delete for a proposal that carries no command id', async () => {
    const { client, deleteMany } = createClient();

    await deleteCommandReplays(client, 'tenant-a', [null]);

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('drops only the real command ids in one delete', async () => {
    const { client, deleteMany } = createClient();

    await deleteCommandReplays(client, 'tenant-a', [
      'command-1',
      null,
      'command-2',
    ]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        command_id: { in: ['command-1', 'command-2'] },
      },
    });
  });
});
