import { describe, expect, it } from 'vitest'
import { getTaskCapabilities } from './task-capabilities'

describe('getTaskCapabilities', () => {
  it('allows start and switch for NOT_STARTED tasks', () => {
    expect(
      getTaskCapabilities({ taskStatus: 'NOT_STARTED', hasOpenLaborEntry: false }),
    ).toEqual({
      canStart: true,
      canSwitch: true,
      canPause: false,
      canComplete: false,
      isDone: false,
      isNotStarted: true,
    })
  })

  it('allows pause and complete for IN_PROGRESS tasks with open labor', () => {
    expect(
      getTaskCapabilities({ taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: true }),
    ).toEqual({
      canStart: false,
      canSwitch: false,
      canPause: true,
      canComplete: true,
      isDone: false,
      isNotStarted: false,
    })
  })

  it('shows resume instead of pause for IN_PROGRESS tasks without open labor', () => {
    expect(
      getTaskCapabilities({ taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: false }),
    ).toEqual({
      canStart: true,
      canSwitch: false,
      canPause: false,
      canComplete: true,
      isDone: false,
      isNotStarted: false,
    })
  })

  it('treats WAITING_PARTS as paused so the mechanic can resume', () => {
    expect(
      getTaskCapabilities({ taskStatus: 'WAITING_PARTS', hasOpenLaborEntry: false }),
    ).toMatchObject({
      canStart: true,
      canSwitch: true,
      canPause: false,
      canComplete: false,
      isDone: false,
    })
  })

  it('hides lifecycle actions for DONE tasks', () => {
    expect(
      getTaskCapabilities({ taskStatus: 'DONE', hasOpenLaborEntry: false }),
    ).toMatchObject({
      canStart: false,
      canSwitch: false,
      canPause: false,
      canComplete: false,
      isDone: true,
    })
  })
})
