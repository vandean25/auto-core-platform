import { ConflictException } from '@nestjs/common';
import {
  STALE_STATUS_CONFLICT_MESSAGE,
  guardedStatusUpdate,
} from './status-transition';

describe('guardedStatusUpdate', () => {
  it('updates with id, tenant, and expected-from status', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await guardedStatusUpdate(updateMany, {
      id: 'po-1',
      tenantId: 'tenant-1',
      from: 'SENT',
      to: 'PARTIAL',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'po-1', tenant_id: 'tenant-1', status: 'SENT' },
      data: { status: 'PARTIAL' },
    });
  });

  it('throws ConflictException when no row matches the expected status', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });

    await expect(
      guardedStatusUpdate(updateMany, {
        id: 'so-1',
        tenantId: 'tenant-1',
        from: 'CONFIRMED',
        to: 'IN_PROGRESS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      guardedStatusUpdate(updateMany, {
        id: 'so-1',
        tenantId: 'tenant-1',
        from: 'CONFIRMED',
        to: 'IN_PROGRESS',
      }),
    ).rejects.toThrow(STALE_STATUS_CONFLICT_MESSAGE);
  });

  it('merges extra where and data without dropping the status guard', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await guardedStatusUpdate(updateMany, {
      id: 'task-1',
      tenantId: 'tenant-1',
      from: 'NOT_STARTED',
      to: 'DONE',
      extraWhere: { workshop_order_id: 'wo-1', status: 'SHOULD_NOT_WIN' },
      extraData: { title: 'Brake pads', status: 'SHOULD_NOT_WIN' },
      conflictMessage: 'Task status changed concurrently',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        workshop_order_id: 'wo-1',
        id: 'task-1',
        tenant_id: 'tenant-1',
        status: 'NOT_STARTED',
      },
      data: { title: 'Brake pads', status: 'DONE' },
    });
  });
});
