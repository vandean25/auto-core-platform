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
import { HrWorkScheduleService } from './hr-work-schedule.service';

describe('HrController', () => {
  let controller: HrController;
  let attendanceService: {
    getMeProfile: jest.Mock;
    getMyClock: jest.Mock;
    getEmployeeClock: jest.Mock;
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
  let workScheduleService: {
    findForEmployee: jest.Mock;
    createForEmployee: jest.Mock;
    updateForEmployee: jest.Mock;
  };

  beforeEach(async () => {
    attendanceService = {
      getMeProfile: jest.fn(),
      getMyClock: jest.fn(),
      getEmployeeClock: jest.fn(),
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
    workScheduleService = {
      findForEmployee: jest.fn(),
      createForEmployee: jest.fn(),
      updateForEmployee: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HrController],
      providers: [
        { provide: HrAttendanceService, useValue: attendanceService },
        { provide: HrLeaveService, useValue: leaveService },
        { provide: HrWorkScheduleService, useValue: workScheduleService },
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
        annualLeaveMinutes: 12875,
      },
      clockState: 'CLOCKED_IN',
      remainingLeaveMinutes: 11055,
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

  it('GET /api/hr/attendance/:employeeId/clock returns current employee clock state', async () => {
    attendanceService.getEmployeeClock.mockResolvedValue({
      state: 'PAUSED',
      lastEvent: null,
      todayEvents: [],
    });

    const result = await controller.employeeClock('emp-2');

    expect(result.state).toBe('PAUSED');
    expect(attendanceService.getEmployeeClock).toHaveBeenCalledWith('emp-2');
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
      allowanceMinutes: 12875,
      carryoverMinutes: 0,
      remainingMinutes: 10300,
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
      minutesCharged: 2850,
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
      minutesCharged: 2850,
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
      allowanceMinutes: 15450,
      carryoverMinutes: 1030,
    });

    const result = await controller.patchLeaveBalance('emp-1', {
      year: 2026,
      allowanceMinutes: 15450,
      carryoverMinutes: 1030,
    });
    expect(result.allowanceMinutes).toBe(15450);
    expect(leaveService.patchLeaveBalance).toHaveBeenCalledWith('emp-1', {
      year: 2026,
      allowanceMinutes: 15450,
      carryoverMinutes: 1030,
    });
  });

  it('GET /api/hr/employees/:id/work-schedule returns schedule history', async () => {
    workScheduleService.findForEmployee.mockResolvedValue({
      current: null,
      history: [],
    });

    const result = await controller.getWorkSchedule('emp-1');

    expect(result.history).toEqual([]);
    expect(workScheduleService.findForEmployee).toHaveBeenCalledWith('emp-1');
  });

  it('POST /api/hr/employees/:id/work-schedule creates a version', async () => {
    const dto = {
      effectiveFrom: '2026-09-01',
      days: [],
    };
    workScheduleService.createForEmployee.mockResolvedValue({
      id: 'schedule-1',
    });

    const result = await controller.createWorkSchedule('emp-1', dto);

    expect(result.id).toBe('schedule-1');
    expect(workScheduleService.createForEmployee).toHaveBeenCalledWith(
      'emp-1',
      dto,
    );
  });

  it('PATCH /api/hr/employees/:id/work-schedule/:scheduleId corrects a version', async () => {
    const dto = { days: [] };
    workScheduleService.updateForEmployee.mockResolvedValue({
      id: 'schedule-1',
    });

    const result = await controller.updateWorkSchedule(
      'emp-1',
      'schedule-1',
      dto,
    );

    expect(result.id).toBe('schedule-1');
    expect(workScheduleService.updateForEmployee).toHaveBeenCalledWith(
      'emp-1',
      'schedule-1',
      dto,
    );
  });
});
