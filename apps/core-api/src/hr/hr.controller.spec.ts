import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceEventSource, AttendanceEventType, EmployeeRole } from '@prisma/client';
import { HrController } from './hr.controller';
import { HrAttendanceService } from './hr-attendance.service';

describe('HrController', () => {
  let controller: HrController;
  let attendanceService: {
    getMeProfile: jest.Mock;
    getMyClock: jest.Mock;
    punchMe: jest.Mock;
    getAttendance: jest.Mock;
    punchEmployee: jest.Mock;
  };

  beforeEach(async () => {
    attendanceService = {
      getMeProfile: jest.fn(),
      getMyClock: jest.fn(),
      punchMe: jest.fn(),
      getAttendance: jest.fn(),
      punchEmployee: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HrController],
      providers: [
        { provide: HrAttendanceService, useValue: attendanceService },
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
    });

    const result = await controller.me();
    expect(result.clockState).toBe('CLOCKED_IN');
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
});
