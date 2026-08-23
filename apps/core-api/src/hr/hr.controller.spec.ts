import { Test, TestingModule } from '@nestjs/testing';
import {
  AttendanceEventSource,
  AttendanceEventType,
  EmployeeRole,
  LeaveRequestStatus,
} from '@prisma/client';
import { HrController } from './hr.controller';
import { HrAttendanceService } from './hr-attendance.service';
import { HrLeaveService } from './hr-leave.service';

describe('HrController', () => {
  let controller: HrController;
  let attendanceService: {
    getMeProfile: jest.Mock;
    getMyClock: jest.Mock;
    punchMe: jest.Mock;
    getAttendance: jest.Mock;
    punchEmployee: jest.Mock;
  };
  let leaveService: {
    getMyLeave: jest.Mock;
    createMyLeave: jest.Mock;
    createEmployeeLeave: jest.Mock;
    cancelLeave: jest.Mock;
    listTeamLeave: jest.Mock;
    updateLeave: jest.Mock;
    patchLeaveBalance: jest.Mock;
  };

  beforeEach(async () => {
    attendanceService = {
      getMeProfile: jest.fn(),
      getMyClock: jest.fn(),
      punchMe: jest.fn(),
      getAttendance: jest.fn(),
      punchEmployee: jest.fn(),
    };
    leaveService = {
      getMyLeave: jest.fn(),
      createMyLeave: jest.fn(),
      createEmployeeLeave: jest.fn(),
      cancelLeave: jest.fn(),
      listTeamLeave: jest.fn(),
      updateLeave: jest.fn(),
      patchLeaveBalance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HrController],
      providers: [
        { provide: HrAttendanceService, useValue: attendanceService },
        { provide: HrLeaveService, useValue: leaveService },
      ],
    }).compile();

    controller = module.get<HrController>(HrController);
  });

  it('GET /api/hr/me returns profile and clockState', async () => {
    attendanceService.getMeProfile.mockResolvedValue({
      employee: {
        id: 'emp-1',
        name: 'Ada',
        role: EmployeeRole.MECHANIC,
        hiredOn: '2024-01-01',
        annualLeaveDays: 25,
      },
      clockState: 'CLOCKED_IN',
      remainingLeaveDays: 22,
      timezone: 'Europe/Vienna',
    });

    const result = await controller.me();
    expect(result.clockState).toBe('CLOCKED_IN');
    expect(result.timezone).toBe('Europe/Vienna');
    expect(attendanceService.getMeProfile).toHaveBeenCalled();
  });

  it('GET /api/hr/me/clock returns clock state and events', async () => {
    attendanceService.getMyClock.mockResolvedValue({
      state: 'CLOCKED_OUT',
      lastEvent: null,
      todayEvents: [],
    });

    const result = await controller.clock();
    expect(result.state).toBe('CLOCKED_OUT');
    expect(attendanceService.getMyClock).toHaveBeenCalled();
  });

  it('POST /api/hr/me/clock punches clock', async () => {
    attendanceService.punchMe.mockResolvedValue({
      state: 'CLOCKED_IN',
      event: {
        id: 'evt-1',
        employeeId: 'emp-1',
        type: AttendanceEventType.CLOCK_IN,
        source: AttendanceEventSource.SELF,
        occurredAt: new Date(),
        note: 'Morning',
        createdAt: new Date(),
      },
    });

    const result = await controller.punch({
      type: AttendanceEventType.CLOCK_IN,
      note: 'Morning',
    });

    expect(result.state).toBe('CLOCKED_IN');
    expect(attendanceService.punchMe).toHaveBeenCalledWith(
      AttendanceEventType.CLOCK_IN,
      'Morning',
    );
  });

  it('GET /api/hr/attendance returns range events for manager', async () => {
    attendanceService.getAttendance.mockResolvedValue([
      {
        id: 'evt-1',
        employeeId: 'emp-1',
        type: AttendanceEventType.CLOCK_IN,
        source: AttendanceEventSource.SELF,
        occurredAt: new Date(),
        note: null,
        createdAt: new Date(),
      },
    ]);

    const result = await controller.getAttendance({
      from: '2026-08-01',
      to: '2026-08-22',
      employeeId: 'emp-1',
    });

    expect(result).toHaveLength(1);
    expect(attendanceService.getAttendance).toHaveBeenCalledWith({
      from: '2026-08-01',
      to: '2026-08-22',
      employeeId: 'emp-1',
    });
  });

  it('POST /api/hr/attendance punches for employee as manager', async () => {
    attendanceService.punchEmployee.mockResolvedValue({
      state: 'CLOCKED_OUT',
      event: {
        id: 'evt-2',
        employeeId: 'emp-2',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.MANAGER,
        occurredAt: new Date(),
        note: 'Close',
        createdAt: new Date(),
      },
    });

    const result = await controller.punchEmployee({
      employeeId: 'emp-2',
      type: AttendanceEventType.CLOCK_OUT,
      note: 'Close',
    });

    expect(result.state).toBe('CLOCKED_OUT');
    expect(attendanceService.punchEmployee).toHaveBeenCalledWith({
      employeeId: 'emp-2',
      type: AttendanceEventType.CLOCK_OUT,
      note: 'Close',
    });
  });

  it('GET /api/hr/me/leave returns my leave', async () => {
    leaveService.getMyLeave.mockResolvedValue({
      year: 2026,
      allowanceDays: 25,
      carryoverDays: 0,
      remainingDays: 20,
      bookings: [],
    });

    const result = await controller.getMyLeave({ year: 2026 });
    expect(result.year).toBe(2026);
    expect(leaveService.getMyLeave).toHaveBeenCalledWith(2026);
  });

  it('POST /api/hr/me/leave creates booking for self', async () => {
    leaveService.createMyLeave.mockResolvedValue({
      id: 'leave-1',
      employeeId: 'emp-1',
      startOn: '2026-09-01',
      endOn: '2026-09-05',
      status: LeaveRequestStatus.BOOKED,
      daysCharged: 5,
      note: 'Vacation',
      createdByUserId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await controller.createMyLeave({
      startOn: '2026-09-01',
      endOn: '2026-09-05',
      note: 'Vacation',
    });
    expect(result.id).toBe('leave-1');
    expect(leaveService.createMyLeave).toHaveBeenCalledWith({
      startOn: '2026-09-01',
      endOn: '2026-09-05',
      note: 'Vacation',
    });
  });

  it('POST /api/hr/leave creates booking for an employee', async () => {
    leaveService.createEmployeeLeave.mockResolvedValue({
      id: 'leave-2',
      employeeId: 'emp-2',
      startOn: '2026-09-01',
      endOn: '2026-09-05',
      status: LeaveRequestStatus.BOOKED,
      daysCharged: 5,
      note: null,
      createdByUserId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await controller.createEmployeeLeave({
      employeeId: 'emp-2',
      startOn: '2026-09-01',
      endOn: '2026-09-05',
    });
    expect(result.id).toBe('leave-2');
    expect(leaveService.createEmployeeLeave).toHaveBeenCalledWith({
      employeeId: 'emp-2',
      startOn: '2026-09-01',
      endOn: '2026-09-05',
    });
  });

  it('POST /api/hr/leave/:id/cancel cancels booking', async () => {
    leaveService.cancelLeave.mockResolvedValue({
      id: 'leave-1',
      status: LeaveRequestStatus.CANCELLED,
    });

    const result = await controller.cancelLeave('leave-1');
    expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(leaveService.cancelLeave).toHaveBeenCalledWith('leave-1');
  });

  it('GET /api/hr/leave lists team leave', async () => {
    leaveService.listTeamLeave.mockResolvedValue([]);
    const result = await controller.listTeamLeave({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(result).toEqual([]);
    expect(leaveService.listTeamLeave).toHaveBeenCalledWith({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('PATCH /api/hr/leave/:id updates booking', async () => {
    leaveService.updateLeave.mockResolvedValue({
      id: 'leave-1',
      startOn: '2026-09-02',
      endOn: '2026-09-06',
    });

    const result = await controller.updateLeave('leave-1', {
      startOn: '2026-09-02',
      endOn: '2026-09-06',
    });
    expect(result.startOn).toBe('2026-09-02');
    expect(leaveService.updateLeave).toHaveBeenCalledWith('leave-1', {
      startOn: '2026-09-02',
      endOn: '2026-09-06',
    });
  });

  it('PATCH /api/hr/employees/:id/leave-balance patches balance', async () => {
    leaveService.patchLeaveBalance.mockResolvedValue({
      id: 'bal-1',
      employeeId: 'emp-1',
      year: 2026,
      allowanceDays: 30,
      carryoverDays: 2,
    });

    const result = await controller.patchLeaveBalance('emp-1', {
      year: 2026,
      allowanceDays: 30,
      carryoverDays: 2,
    });
    expect(result.allowanceDays).toBe(30);
    expect(leaveService.patchLeaveBalance).toHaveBeenCalledWith('emp-1', {
      year: 2026,
      allowanceDays: 30,
      carryoverDays: 2,
    });
  });
});
