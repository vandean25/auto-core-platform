import { Test, TestingModule } from '@nestjs/testing';
import {
  LaborPauseReason,
  WorkshopMediaUrlStrategy,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { MechanicQueueResponseDto } from './dto/mechanic-queue-item.dto';
import type { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import type { SaveDiagnosticsResponseDto } from './dto/save-diagnostics.dto';
import type { RequestPartResponseDto } from './dto/request-part.dto';
import type { MediaUploadPolicyDto, WorkshopMediaDto } from './dto/media.dto';
import { MechanicController } from './mechanic.controller';
import { MechanicService } from './mechanic.service';

const MECHANIC_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';

describe('MechanicController', () => {
  let controller: MechanicController;

  const mockMechanicService = {
    resolveMechanic: jest.fn().mockResolvedValue(MECHANIC_ID),
    getMechanicQueue: jest.fn().mockResolvedValue([]),
    getMechanicTaskDetail: jest.fn(),
    startTask: jest.fn(),
    switchTask: jest.fn(),
    pauseTask: jest.fn(),
    completeTask: jest.fn(),
    saveDiagnostics: jest.fn(),
    requestPart: jest.fn(),
    createMediaUploadPolicy: jest.fn(),
    saveMediaMetadata: jest.fn(),
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
    mockMechanicService.resolveMechanic.mockResolvedValue(MECHANIC_ID);
  });

  it('getQueue calls resolveMechanic then getMechanicQueue', async () => {
    mockMechanicService.getMechanicQueue.mockResolvedValue([]);

    const result = await controller.getQueue();

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.getMechanicQueue).toHaveBeenCalledWith(
      MECHANIC_ID,
    );
    expect(result).toEqual({ data: [] } satisfies MechanicQueueResponseDto);
  });

  it('getTaskDetail calls resolveMechanic then getMechanicTaskDetail', async () => {
    mockMechanicService.getMechanicTaskDetail.mockResolvedValue(baseDetail);

    const result = await controller.getTaskDetail(TASK_ID);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.getMechanicTaskDetail).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
    );
    expect(result).toBe(baseDetail);
  });

  it('startTask calls resolveMechanic then startTask', async () => {
    mockMechanicService.startTask.mockResolvedValue(baseDetail);

    const result = await controller.startTask(TASK_ID);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.startTask).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
    );
    expect(result).toBe(baseDetail);
  });

  it('switchTask calls resolveMechanic then switchTask with dto', async () => {
    mockMechanicService.switchTask.mockResolvedValue(baseDetail);
    const dto = {
      previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
    };

    const result = await controller.switchTask(TASK_ID, dto);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.switchTask).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      dto,
    );
    expect(result).toBe(baseDetail);
  });

  it('pauseTask calls resolveMechanic then pauseTask with dto', async () => {
    mockMechanicService.pauseTask.mockResolvedValue(baseDetail);
    const dto = { pauseReason: LaborPauseReason.WAITING_PARTS };

    const result = await controller.pauseTask(TASK_ID, dto);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.pauseTask).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      dto,
    );
    expect(result).toBe(baseDetail);
  });

  it('completeTask calls resolveMechanic then completeTask', async () => {
    mockMechanicService.completeTask.mockResolvedValue(baseDetail);

    const result = await controller.completeTask(TASK_ID);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.completeTask).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
    );
    expect(result).toBe(baseDetail);
  });

  it('saveDiagnostics calls resolveMechanic then saveDiagnostics with dto', async () => {
    const expected: SaveDiagnosticsResponseDto = {
      taskId: TASK_ID,
      mechanicNotes: 'Oil leak near valve cover.',
    };
    mockMechanicService.saveDiagnostics.mockResolvedValue(expected);
    const dto = { mechanicNotes: 'Oil leak near valve cover.' };

    const result = await controller.saveDiagnostics(TASK_ID, dto);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.saveDiagnostics).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      dto,
    );
    expect(result).toBe(expected);
  });

  it('requestPart calls resolveMechanic then requestPart with dto', async () => {
    const expected: RequestPartResponseDto = {
      id: 'line-1',
      itemNo: 'OIL-5W30',
      description: '5W-30 Engine Oil 5L',
      qty: 2,
      partExecutionStatus: WorkshopPartLineExecutionStatus.PENDING_PICK,
    };
    mockMechanicService.requestPart.mockResolvedValue(expected);
    const dto = {
      itemNo: 'OIL-5W30',
      description: '5W-30 Engine Oil 5L',
      qty: 2,
    };

    const result = await controller.requestPart(TASK_ID, dto);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.requestPart).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      dto,
    );
    expect(result).toBe(expected);
  });

  it('createMediaUploadPolicy calls resolveMechanic then createMediaUploadPolicy', async () => {
    const expected: MediaUploadPolicyDto = {
      uploadUrl: 'https://storage.googleapis.com/bucket',
      formFields: { key: 'tenants/t1/orders/o1/tasks/t1/uuid.jpg' },
      storageBucket: 'workshop-media',
      storageKey: 'tenants/t1/orders/o1/tasks/t1/uuid.jpg',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
    mockMechanicService.createMediaUploadPolicy.mockResolvedValue(expected);
    const dto = { mimeType: 'image/jpeg' as const, sizeBytes: 1024 * 100 };

    const result = await controller.createMediaUploadPolicy(TASK_ID, dto);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.createMediaUploadPolicy).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      dto,
    );
    expect(result).toBe(expected);
  });

  it('saveMediaMetadata calls resolveMechanic then saveMediaMetadata', async () => {
    const expected: WorkshopMediaDto = {
      id: 'media-1',
      workshopOrderId: 'order-1',
      workshopTaskId: TASK_ID,
      uploadedByEmployeeId: MECHANIC_ID,
      storageBucket: 'workshop-media',
      storageKey: 'tenants/t1/orders/o1/tasks/t1/uuid.jpg',
      urlStrategy: WorkshopMediaUrlStrategy.SIGNED,
      mimeType: 'image/jpeg',
      sizeBytes: 102400,
      durationSeconds: null,
      caption: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockMechanicService.saveMediaMetadata.mockResolvedValue(expected);
    const dto = {
      storageKey: 'tenants/t1/orders/o1/tasks/t1/uuid.jpg',
      storageBucket: 'workshop-media',
      mimeType: 'image/jpeg' as const,
      sizeBytes: 102400,
    };

    const result = await controller.saveMediaMetadata(TASK_ID, dto);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.saveMediaMetadata).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      dto,
    );
    expect(result).toBe(expected);
  });

  it('uploadVoiceNote calls resolveMechanic then uploadVoiceNote with file', async () => {
    const expectedDraft = {
      text: 'Clutch bearing worn — replace.',
      detectedLanguage: 'en',
      provider: 'openai',
      model: 'whisper-1',
      durationSeconds: 9.3,
    };
    mockMechanicService.uploadVoiceNote = jest
      .fn()
      .mockResolvedValue(expectedDraft);

    const fakeFile = {
      fieldname: 'audio',
      originalname: 'note.webm',
      mimetype: 'audio/webm',
      buffer: Buffer.alloc(2048),
      size: 2048,
    } as Express.Multer.File;

    const result = await controller.uploadVoiceNote(TASK_ID, fakeFile);

    expect(mockMechanicService.resolveMechanic).toHaveBeenCalledTimes(1);
    expect(mockMechanicService.uploadVoiceNote).toHaveBeenCalledWith(
      MECHANIC_ID,
      TASK_ID,
      fakeFile,
    );
    expect(result).toBe(expectedDraft);
  });
});
