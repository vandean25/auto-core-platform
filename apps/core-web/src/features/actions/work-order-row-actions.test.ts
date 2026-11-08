import { describe, expect, it, vi } from 'vitest'

import {
  isWorkshopCheckInOpenStatus,
  isWorkshopTechAssignableStatus,
} from './action-role-predicates'
import {
  ENTITY_ACTION_IDS,
  filterEntityActions,
  isValidEntityActionId,
  resolveEntityActionChildren,
} from './entity-action'
import {
  createWorkshopOrderRowActions,
  runAssignWorkshopOrderMechanic,
  runGenerateWorkshopJobCardPdf,
  runUpdateWorkshopOrderTaskStatus,
  type WorkshopOrderListRow,
  type WorkshopOrderRowActionContext,
} from './work-order-row-actions'

const t = ((key: string) => key) as import('i18next').TFunction<'workshop'>

describe('work order row actions', () => {
  const definitions = createWorkshopOrderRowActions(t)
  const row: WorkshopOrderListRow = {
    id: 'order-1',
    orderNo: 'WO-1',
    status: 'INTAKE' as const,
    customer: 'Ada Lovelace',
    vehicle: '2024 Audi A4',
    openedAt: '2026-01-01',
    mechanicId: null,
    tasks: [
      {
        id: 'task-1',
        title: 'Oil Change',
        lineItemsVersion: 0,
        status: 'IN_PROGRESS',
        done: false,
        lineItems: [],
      },
      {
        id: 'task-2',
        title: 'Brake Check',
        lineItemsVersion: 0,
        status: 'DONE',
        done: true,
        lineItems: [],
      },
    ],
  }

  it('hides task status from a role that cannot manage workshop tasks', () => {
    expect(filterEntityActions(definitions, 'MECHANIC', row).map((action) => action.id)).not.toContain(
      ENTITY_ACTION_IDS.workOrderTaskState,
    )
    expect(filterEntityActions(definitions, 'ADMIN', row).map((action) => action.id)).toContain(
      ENTITY_ACTION_IDS.workOrderTaskState,
    )
  })

  it('exposes open, check-in, PDF, assignMechanic, and taskState actions for standard roles', () => {
    const actions = filterEntityActions(definitions, 'ADMIN', row)
    expect(actions.map((action) => action.id)).toEqual([
      ENTITY_ACTION_IDS.workOrderOpen,
      ENTITY_ACTION_IDS.workOrderCheckIn,
      ENTITY_ACTION_IDS.workOrderJobCardPdf,
      'workOrder.recordTyreMeasurement',
      ENTITY_ACTION_IDS.workOrderAssignMechanic,
      ENTITY_ACTION_IDS.workOrderTaskState,
    ])
  })

  it('disables check-in, assignMechanic, and taskState when the order is invoiced', () => {
    const invoiced: WorkshopOrderListRow = { ...row, status: 'INVOICED' }
    const actions = filterEntityActions(definitions, 'ADMIN', invoiced)
    expect(actions.map((action) => action.id)).toEqual([
      ENTITY_ACTION_IDS.workOrderOpen,
      ENTITY_ACTION_IDS.workOrderJobCardPdf,
      'workOrder.recordTyreMeasurement',
    ])
    expect(isWorkshopCheckInOpenStatus(invoiced.status)).toBe(false)
    expect(isWorkshopTechAssignableStatus(invoiced.status)).toBe(false)
  })

  it('disables assignMechanic when COMPLETED but keeps taskState enabled while tasks exist', () => {
    const completed: WorkshopOrderListRow = { ...row, status: 'COMPLETED' }
    const actions = filterEntityActions(definitions, 'ADMIN', completed)
    expect(actions.map((action) => action.id)).toEqual([
      ENTITY_ACTION_IDS.workOrderOpen,
      ENTITY_ACTION_IDS.workOrderJobCardPdf,
      'workOrder.recordTyreMeasurement',
      ENTITY_ACTION_IDS.workOrderTaskState,
    ])
  })

  it.each(['SCHEDULED', 'INTAKE', 'IN_PROGRESS', 'COMPLETED', 'INVOICED'] as const)(
    'offers tyre measurement on %s orders and navigates to its dialog',
    (status) => {
      const record = { ...row, status }
      const action = filterEntityActions(definitions, 'TECH', record).find(
        (definition) => definition.id === 'workOrder.recordTyreMeasurement',
      )
      expect(action).toBeDefined()
      const navigate = vi.fn()
      action?.run(record, { navigate, generatePdf: { mutateAsync: vi.fn() } as never, t })
      expect(navigate).toHaveBeenCalledWith('/workshop/orders/order-1?action=recordTyreMeasurement')
    },
  )

  it.each(['ACCOUNTANT', 'SERVICE_ADVISOR', 'MECHANIC', 'SUPER_ADMIN', 'owner', '', undefined])(
    'does not offer tyre measurement to %s',
    (role) => {
      expect(filterEntityActions(definitions, role, row).map((action) => action.id))
        .not.toContain('workOrder.recordTyreMeasurement')
    },
  )

  // Regression: Cmd+K and the row menu could start a second job card PDF while the first was still generating.
  it('does not start a second job card PDF while one is generating', async () => {
    const mutateAsync = vi.fn()
    await runGenerateWorkshopJobCardPdf(row, { generatePdf: { mutateAsync, isPending: true } as never, t })
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('navigates to the order detail when open runs', () => {
    const navigate = vi.fn()
    const open = definitions.find((action) => action.id === ENTITY_ACTION_IDS.workOrderOpen)
    open?.run(row, { navigate, generatePdf: { mutateAsync: vi.fn() } as never, t })
    expect(navigate).toHaveBeenCalledWith('/workshop/orders/order-1')
  })

  it('builds assignMechanic sub-menu children and calls assignMechanic on selection', async () => {
    const assignMechanic = vi.fn().mockResolvedValue(undefined)
    const context: WorkshopOrderRowActionContext = {
      navigate: vi.fn(),
      generatePdf: { mutateAsync: vi.fn() } as never,
      t,
      mechanics: [
        { id: 'mech-1', name: 'Alex Tech' },
        { id: 'mech-2', name: 'Sam Wrench' },
      ],
      assignMechanic,
    }
    const action = definitions.find(
      (item) => item.id === ENTITY_ACTION_IDS.workOrderAssignMechanic,
    )
    const children = resolveEntityActionChildren(action?.children, row, context) ?? []

    expect(children.map((child) => ({ id: child.id, label: child.label }))).toEqual([
      { id: 'workOrder.assignMechanic.mech1', label: 'Alex Tech' },
      { id: 'workOrder.assignMechanic.mech2', label: 'Sam Wrench' },
    ])
    for (const child of children) {
      expect(isValidEntityActionId(child.id)).toBe(true)
    }

    await children[0]?.run?.(row, context)
    expect(assignMechanic).toHaveBeenCalledWith('order-1', 'mech-1', null)

    const assignedRow: WorkshopOrderListRow = { ...row, mechanicId: 'mech-1' }
    const assignedChildren =
      resolveEntityActionChildren(action?.children, assignedRow, context) ?? []
    expect(assignedChildren.find((c) => c.id === 'workOrder.assignMechanic.mech1')?.isEnabled?.(assignedRow)).toBe(false)
    const unassignChild = assignedChildren.find(
      (c) => c.id === 'workOrder.assignMechanic.unassigned',
    )
    expect(unassignChild).toBeDefined()
    await unassignChild?.run?.(assignedRow, context)
    expect(assignMechanic).toHaveBeenCalledWith('order-1', null, 'mech-1')
  })

  it('builds two-step taskState sub-menu (pick task -> done / reopen) and updates task status', async () => {
    const updateTaskStatus = vi.fn().mockResolvedValue(undefined)
    const context: WorkshopOrderRowActionContext = {
      navigate: vi.fn(),
      generatePdf: { mutateAsync: vi.fn() } as never,
      t,
      updateTaskStatus,
    }
    const action = definitions.find(
      (item) => item.id === ENTITY_ACTION_IDS.workOrderTaskState,
    )
    const taskChildren = resolveEntityActionChildren(action?.children, row, context) ?? []
    expect(taskChildren.map((child) => ({ id: child.id, label: child.label }))).toEqual([
      { id: 'workOrder.taskState.task1', label: 'Oil Change' },
      { id: 'workOrder.taskState.task2', label: 'Brake Check' },
    ])

    const task1Leaves =
      resolveEntityActionChildren(taskChildren[0]?.children, row, context) ?? []
    expect(task1Leaves.map((leaf) => leaf.id)).toEqual([
      'workOrder.taskState.task1.NOT_STARTED',
      'workOrder.taskState.task1.IN_PROGRESS',
      'workOrder.taskState.task1.WAITING_PARTS',
      'workOrder.taskState.task1.WAITING_CUSTOMER',
      'workOrder.taskState.task1.PAUSED',
      'workOrder.taskState.task1.DONE',
    ])
    expect(task1Leaves.find((leaf) => leaf.id.endsWith('IN_PROGRESS'))?.isEnabled?.(row)).toBe(false)
    expect(task1Leaves.find((leaf) => leaf.id.endsWith('DONE'))?.isEnabled?.(row)).toBe(true)

    await task1Leaves.find((leaf) => leaf.id.endsWith('WAITING_PARTS'))?.run?.(row, context)
    expect(updateTaskStatus).toHaveBeenCalledWith('order-1', 'task-1', 'WAITING_PARTS')

    const task2Leaves =
      resolveEntityActionChildren(taskChildren[1]?.children, row, context) ?? []
    expect(task2Leaves.find((leaf) => leaf.id.endsWith('DONE'))?.isEnabled?.(row)).toBe(false)
    expect(task2Leaves.find((leaf) => leaf.id.endsWith('IN_PROGRESS'))?.isEnabled?.(row)).toBe(true)

    await task2Leaves.find((leaf) => leaf.id.endsWith('IN_PROGRESS'))?.run?.(row, context)
    expect(updateTaskStatus).toHaveBeenCalledWith('order-1', 'task-2', 'IN_PROGRESS')
  })

  it('offers reschedule only when the order can be moved, and runs the shared request', async () => {
    const reschedule = vi.fn().mockResolvedValue(undefined)
    const context: WorkshopOrderRowActionContext = {
      navigate: vi.fn(),
      generatePdf: { mutateAsync: vi.fn() } as never,
      t,
      reschedule,
    }
    const booked: WorkshopOrderListRow = {
      ...row,
      status: 'SCHEDULED',
      bayId: 'bay-1',
      scheduledStartAt: '2026-08-21T06:00:00.000Z',
      scheduledEndAt: '2026-08-21T07:30:00.000Z',
    }
    expect(filterEntityActions(definitions, 'MECHANIC', booked).map((action) => action.id)).toContain(
      ENTITY_ACTION_IDS.workOrderReschedule,
    )
    expect(filterEntityActions(definitions, 'MECHANIC', row).map((action) => action.id)).not.toContain(
      ENTITY_ACTION_IDS.workOrderReschedule,
    )
    expect(
      filterEntityActions(definitions, 'MECHANIC', { ...booked, status: 'IN_PROGRESS' }).map(
        (action) => action.id,
      ),
    ).not.toContain(ENTITY_ACTION_IDS.workOrderReschedule)

    const action = definitions.find((item) => item.id === ENTITY_ACTION_IDS.workOrderReschedule)
    const dates = resolveEntityActionChildren(action?.children, booked, context) ?? []
    expect(dates.length).toBeGreaterThan(0)
    expect(dates.some((date) => date.id.endsWith('20260821'))).toBe(false)
    await dates[0]?.run?.(booked, context)
    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', bayId: 'bay-1', startIso: booked.scheduledStartAt }),
    )
  })

  it('runs assignMechanic and updateTaskStatus helpers with error handling', async () => {
    const mutateAssign = vi.fn().mockResolvedValue({})
    await runAssignWorkshopOrderMechanic('order-1', 'mech-1', null, mutateAssign, t)
    expect(mutateAssign).toHaveBeenCalledWith({ orderId: 'order-1', mechanicId: 'mech-1' })

    mutateAssign.mockClear()
    await runAssignWorkshopOrderMechanic('order-1', null, 'mech-1', mutateAssign, t)
    expect(mutateAssign).toHaveBeenCalledWith({ orderId: 'order-1', mechanicId: null })

    const mutateTask = vi.fn().mockResolvedValue({})
    await runUpdateWorkshopOrderTaskStatus('order-1', 'task-1', 'DONE', mutateTask, t)
    expect(mutateTask).toHaveBeenCalledWith({
      orderId: 'order-1',
      taskId: 'task-1',
      status: 'DONE',
    })
  })
})
