import { EventEmitter2 } from '@nestjs/event-emitter';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MechanicMediaStorage } from './mechanic-media.storage.js';

export const TENANT_ID = 'tenant-1';
export const MECHANIC_ID = 'mechanic-employee-1';
export const TASK_ID = 'task-1';
export const ORDER_ID = 'order-1';

export const mockPrisma = {
  employee: { findFirst: jest.fn() },
  workshopTask: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  workshopTaskLineItem: {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  partsReservation: { findMany: jest.fn().mockResolvedValue([]) },
  workshopInspection: { findFirst: jest.fn() },
  workshopInspectionItem: { updateMany: jest.fn() },
  workshopMedia: { create: jest.fn() },
  workshopVoiceNoteDraft: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  laborEntry: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  workshopOrder: { updateMany: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
  $transaction: jest.fn(),
} as unknown as PrismaService;

export const mockTenantContext = {
  getAuthenticatedUser: jest.fn(),
  getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
} as unknown as TenantContextService;

export const mockRealtimeService = {
  emitEntityUpdated: jest.fn(),
} as unknown as DashboardRealtimeService;

export const mockEventEmitter = {
  emit: jest.fn(),
} as unknown as EventEmitter2;

export const mockMediaStorage = {
  generateUploadPolicy: jest.fn(),
} as unknown as MechanicMediaStorage;

export const mockVoiceTranslationService = {
  getTargetLanguageCode: jest.fn().mockResolvedValue('de'),
  translateVoiceNote: jest.fn(),
} as unknown as import('../voice-translation/voice-translation.service.js').VoiceTranslationService;

export const mockVehicleLedger = {
  completeStockPrep: jest.fn(),
} as unknown as import('../vehicle-stock/vehicle-ledger.service.js').VehicleLedgerService;
