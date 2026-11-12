// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  PLANNER_VIEW_MODE_STORAGE_KEY,
  persistPlannerViewMode,
  readPlannerViewMode,
} from './planner-view-mode'

describe('planner-view-mode', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('defaults to day when storage is empty', () => {
    expect(readPlannerViewMode()).toBe('day')
  })

  it('reads week from localStorage', () => {
    window.localStorage.setItem(PLANNER_VIEW_MODE_STORAGE_KEY, 'week')
    expect(readPlannerViewMode()).toBe('week')
  })

  it('ignores invalid stored values', () => {
    window.localStorage.setItem(PLANNER_VIEW_MODE_STORAGE_KEY, 'month')
    expect(readPlannerViewMode()).toBe('day')
  })

  it('persists day and week modes', () => {
    persistPlannerViewMode('week')
    expect(window.localStorage.getItem(PLANNER_VIEW_MODE_STORAGE_KEY)).toBe('week')
    persistPlannerViewMode('day')
    expect(window.localStorage.getItem(PLANNER_VIEW_MODE_STORAGE_KEY)).toBe('day')
  })
})
