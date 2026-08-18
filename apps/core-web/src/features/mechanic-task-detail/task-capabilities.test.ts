import { describe, expect, it } from 'vitest'
import { getTaskCapabilities } from './task-capabilities'

describe('getTaskCapabilities', () => {
  it('allows start and switch for NOT_STARTED tasks', () => {
    expect(getTaskCapabilities('NOT_STARTED')).toEqual({
      canStart: true,
      canSwitch: true,
      canPause: false,
      canComplete: false,
      isDone: false,
      isNotStarted: true,
    })
  })

  it('allows pause and complete for IN_PROGRESS tasks', () => {
    expect(getTaskCapabilities('IN_PROGRESS')).toEqual({
      canStart: false,
      canSwitch: false,
      canPause: true,
      canComplete: true,
      isDone: false,
      isNotStarted: false,
    })
  })

  it('treats WAITING_PARTS as paused so the mechanic can resume', () => {
    expect(getTaskCapabilities('WAITING_PARTS')).toMatchObject({
      canStart: true,
      canSwitch: true,
      canPause: false,
      canComplete: false,
      isDone: false,
    })
  })

  it('hides lifecycle actions for DONE tasks', () => {
    expect(getTaskCapabilities('DONE')).toMatchObject({
      canStart: false,
      canSwitch: false,
      canPause: false,
      canComplete: false,
      isDone: true,
    })
  })
})
