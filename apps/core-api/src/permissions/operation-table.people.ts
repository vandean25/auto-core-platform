import {
  ADMINS,
  BACK_OFFICE,
  BACK_OFFICE_DEMO,
  BACK_OFFICE_TECH,
  EVERY_ROLE,
  op,
} from './operation-helpers.js';
import type { OperationTable } from './operation-types.js';

export const PEOPLE_OPERATIONS: OperationTable = {
  'EmployeeController.findAll': op('employee.read', BACK_OFFICE_DEMO, 'tenant'),
  'EmployeeController.findOne': op('employee.read', BACK_OFFICE_DEMO, 'tenant'),
  'EmployeeController.create': op('employee.create', BACK_OFFICE, 'tenant'),
  'EmployeeController.update': op('employee.update', BACK_OFFICE, 'tenant'),
  'EmployeeController.remove': op('employee.delete', BACK_OFFICE, 'tenant', [
    'business_state',
  ]),
  'InspectorEvidenceController.list': op(
    'inspector_evidence.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'InspectorEvidenceController.assess': op(
    'inspector_evidence.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'InspectorEvidenceController.create': op(
    'inspector_evidence.create',
    BACK_OFFICE,
    'tenant',
  ),
  'InspectorEvidenceController.review': op(
    'inspector_evidence.review',
    BACK_OFFICE,
    'tenant',
    ['business_state'],
  ),
  'HrController.me': op('hr.self.read', EVERY_ROLE, 'self', [
    'employee_identity',
    'own_record',
  ]),
  'HrController.clock': op('hr.self.clock.read', EVERY_ROLE, 'self', [
    'employee_identity',
    'own_record',
  ]),
  'HrController.punch': op('hr.self.clock.punch', BACK_OFFICE_TECH, 'self', [
    'employee_identity',
    'own_record',
  ]),
  'HrController.getAttendance': op('hr.attendance.read', ADMINS, 'tenant'),
  'HrController.employeeClock': op('hr.attendance.read', ADMINS, 'tenant'),
  'HrController.punchEmployee': op('hr.attendance.punch', ADMINS, 'tenant'),
  'HrController.getMyLeave': op('hr.self.leave.read', EVERY_ROLE, 'self', [
    'employee_identity',
    'own_record',
  ]),
  'HrController.createMyLeave': op(
    'hr.self.leave.create',
    BACK_OFFICE_TECH,
    'self',
    ['employee_identity', 'own_record'],
  ),
  'HrController.createEmployeeLeave': op('hr.leave.create', ADMINS, 'tenant'),
  'HrController.cancelLeave': op(
    'hr.leave.cancel',
    BACK_OFFICE_TECH,
    'tenant',
    ['employee_identity', 'own_record', 'business_state'],
  ),
  'HrController.listTeamLeave': op(
    'hr.leave.read',
    BACK_OFFICE_DEMO,
    'tenant',
    ['employee_identity', 'own_record'],
  ),
  'HrController.updateLeave': op('hr.leave.update', ADMINS, 'tenant', [
    'business_state',
  ]),
  'HrController.patchLeaveBalance': op(
    'hr.leave_balance.update',
    ADMINS,
    'tenant',
  ),
  'HrController.getWorkSchedule': op('hr.schedule.read', BACK_OFFICE, 'site'),
  'HrController.createWorkSchedule': op('hr.schedule.create', ADMINS, 'site'),
  'HrController.updateWorkSchedule': op('hr.schedule.update', ADMINS, 'site'),
  'TenantMemberController.findAll': op('member.read', ADMINS, 'tenant'),
  'TenantMemberController.invite': op('member.invite', ADMINS, 'tenant'),
  'TenantMemberController.update': op('member.update', ADMINS, 'tenant'),
};
