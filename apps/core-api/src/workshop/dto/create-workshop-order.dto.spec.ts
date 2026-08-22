import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkshopOrderStatus } from '@prisma/client';
import { CreateWorkshopOrderDto } from './create-workshop-order.dto';

const vehicleId = '550e8400-e29b-41d4-a716-446655440000';
const customerId = '550e8400-e29b-41d4-a716-446655440001';

describe('CreateWorkshopOrderDto', () => {
  it('accepts SCHEDULED as create status', async () => {
    const dto = plainToInstance(CreateWorkshopOrderDto, {
      vehicleId,
      customerId,
      status: WorkshopOrderStatus.SCHEDULED,
      bayId: '550e8400-e29b-41d4-a716-446655440002',
      scheduledStartAt: '2026-08-21T08:00:00.000Z',
      scheduledEndAt: '2026-08-21T09:00:00.000Z',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects IN_PROGRESS as create status', async () => {
    const dto = plainToInstance(CreateWorkshopOrderDto, {
      vehicleId,
      customerId,
      odometer: 1,
      fuelLevel: 10,
      status: WorkshopOrderStatus.IN_PROGRESS,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });
});
