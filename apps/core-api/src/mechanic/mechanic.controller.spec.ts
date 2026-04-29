import { Test, TestingModule } from '@nestjs/testing';
import { LaborPauseReason, WorkshopTaskStatus } from '@prisma/client';
import { MechanicQueueResponseDto } from './dto/mechanic-queue-item.dto';
import type { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import { MechanicController } from './mechanic.controller';
import { MechanicService } from './mechanic.service';

const MECHANIC_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';

describe('MechanicController', () => {
  let controller: MechanicController;

  const mockMechanicService = {
    assertMechanicAccess: jest.fn().mockResolvedValue(undefined),
    getMechanicQueue: jest.fn().mockResolvedValue([]),
    getMechanicTaskDetail: jest.fn(),
    startTask: jest.fn(),
    switchTask: jest.fn(),
    pauseTask: jest.fn(),
    completeTask: jest.fn(),
  };

  const baseDetail: MechanicTaskDetailDto = {
    taskId: TASK_ID,
    taskTitle: 'Oil change',
    taskStatus: WorkshopTaskStatus.IN_PROGRESS,
    mechanicNotes: null,
    orderId: 'order-1',
    orderNumber: 'WO-2026-0001',
    reportedComplaint: null,
    odometer: 50000,
    vehicle: { id: 'v1', make: 'VW', model: 'Golf', year: 2020 },
    bay: null,
    sequence: 1,
    scheduledDate: null,
    lineItems: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MechanicController,
        { provide: MechanicService, useValue: mockMechanicService },
      ],
    }).compile();

    controller = module.get(MechanicController);
    jest.clearAllMocks();
    mockMechanicService.assertMechanicAccess.mockResolvedValue(undefined);
  });

  it('getQueue calls assertMechanicAccess then getMechanicQueue', async () => {
    mockMechanicService.getMechanicQueue.mockResolvedValue([]);

    const result = await controller.getQueue(MECHANIC_ID);

    expect(mockMechanicService.assertMechanicAccess).toHaveBeenCalledWith(
      MECHANIC_ID,
    );
    expect(mockMechanicService.getMechanicQueue).toHaveBeenCalledWith(
      MECHANIC_ID,
    );
    expect(result).toEqual({ data: [] } satisfies MechanicQueueResponseDto);
  });

  it('getTaskDetail calls assertMechanicAccess then getMechanicTaskDetail', async () => {
    mockMechanicService.getMechanicTaskDetail.mockResolvedValue(baseDetail);

    const result = await controller.getTaskDetail(MECHANIC_ID, TASK_ID);

    expect(mockMechanicService.assertMechanicAccess).toHaveBeenCalledWith(
      MECHANIC_ID,
    );
    expect(mockMechanicService.getMechanicTaskDetail).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
    );
    expect(result).toBe(baseDetail);
  });

  it('startTask calls assertMechanicAccess then startTask', async () => {
    mockMechanicService.startTask.mockResolvedValue(baseDetail);

    const result = await controller.startTask(MECHANIC_ID, TASK_ID);

    expect(mockMechanicService.assertMechanicAccess).toHaveBeenCalledWith(MECHANIC_ID);
    expect(mockMechanicService.startTask).toHaveBeenCalledWith(MECHANIC_ID, TASK_ID);
    expect(result).toBe(baseDetail);
  });

  it('switchTask calls assertMechanicAccess then switchTask with dto', async () => {
    mockMechanicService.switchTask.mockResolvedValue(baseDetail);
    const dto = { previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY };

    const result = await controller.switchTask(MECHANIC_ID, TASK_ID, dto);

    expect(mockMechanicService.assertMechanicAccess).toHaveBeenCalledWith(MECHANIC_ID);
    expect(mockMechanicService.switchTask).toHaveBeenCalledWith(MECHANIC_ID, TASK_ID, dto);
    expect(result).toBe(baseDetail);
  });

  it('pauseTask calls assertMechanicAccess then pauseTask with dto', async () => {
    mockMechanicService.pauseTask.mockResolvedValue(baseDetail);
    const dto = { pauseReason: LaborPauseReason.WAITING_PARTS };

    const result = await controller.pauseTask(MECHANIC_ID, TASK_ID, dto);

    expect(mockMechanicService.assertMechanicAccess).toHaveBeenCalledWith(MECHANIC_ID);
    expect(mockMechanicService.pauseTask).toHaveBeenCalledWith(MECHANIC_ID, TASK_ID, dto);
    expect(result).toBe(baseDetail);
  });

  it('completeTask calls assertMechanicAccess then completeTask', async () => {
    mockMechanicService.completeTask.mockResolvedValue(baseDetail);

    const result = await controller.completeTask(MECHANIC_ID, TASK_ID);

    expect(mockMechanicService.assertMechanicAccess).toHaveBeenCalledWith(MECHANIC_ID);
    expect(mockMechanicService.completeTask).toHaveBeenCalledWith(MECHANIC_ID, TASK_ID);
    expect(result).toBe(baseDetail);
  });
});

