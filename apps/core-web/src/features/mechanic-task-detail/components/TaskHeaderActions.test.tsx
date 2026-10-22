import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { deWorkshop } from '@/test/de-workshop'
import type { TaskHeaderActionHandlers, TaskHeaderActionState } from '../task-capabilities'
import { TaskHeaderActions } from './TaskHeaderActions'

const header = deWorkshop.mechanic.taskDetail.header

function makeState(overrides: Partial<TaskHeaderActionState> = {}): TaskHeaderActionState {
  return {
    canStart: true,
    canSwitch: true,
    canPause: true,
    canComplete: true,
    isNotStarted: true,
    startPending: false,
    switchPending: false,
    pausePending: false,
    completePending: false,
    ...overrides,
  }
}

function makeHandlers() {
  return {
    onStart: vi.fn<() => void>(),
    onOpenSwitch: vi.fn<() => void>(),
    onOpenPause: vi.fn<() => void>(),
    onComplete: vi.fn<() => void>(),
  } satisfies TaskHeaderActionHandlers
}

describe('TaskHeaderActions', () => {
  it('shows or hides each action from can* flags', () => {
    const { rerender } = render(
      <TaskHeaderActions state={makeState()} handlers={makeHandlers()} />,
    )
    expect(screen.getByRole('button', { name: header.start })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: header.switchHere })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: header.pause })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: header.complete })).toBeInTheDocument()

    rerender(
      <TaskHeaderActions
        state={makeState({
          canStart: false,
          canSwitch: false,
          canPause: false,
          canComplete: false,
        })}
        handlers={makeHandlers()}
      />,
    )
    expect(screen.queryByRole('button', { name: header.start })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: header.resume })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: header.switchHere })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: header.pause })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: header.complete })).not.toBeInTheDocument()
  })

  it('uses Start vs Resume label from isNotStarted', () => {
    const { rerender } = render(
      <TaskHeaderActions state={makeState({ isNotStarted: true })} handlers={makeHandlers()} />,
    )
    expect(screen.getByRole('button', { name: header.start })).toBeInTheDocument()

    rerender(
      <TaskHeaderActions state={makeState({ isNotStarted: false })} handlers={makeHandlers()} />,
    )
    expect(screen.getByRole('button', { name: header.resume })).toBeInTheDocument()
  })

  it('disables Switch while start or switch is pending', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskHeaderActions state={makeState({ switchPending: true })} handlers={handlers} />,
    )
    expect(screen.getByRole('button', { name: header.switchHere })).toBeDisabled()

    rerender(
      <TaskHeaderActions state={makeState({ startPending: true })} handlers={handlers} />,
    )
    expect(screen.getByRole('button', { name: header.switchHere })).toBeDisabled()
  })

  it('disables each button while its pending flag is set', () => {
    render(
      <TaskHeaderActions
        state={makeState({
          startPending: true,
          pausePending: true,
          completePending: true,
        })}
        handlers={makeHandlers()}
      />,
    )
    expect(screen.getByRole('button', { name: header.start })).toBeDisabled()
    expect(screen.getByRole('button', { name: header.pause })).toBeDisabled()
    expect(screen.getByRole('button', { name: header.complete })).toBeDisabled()
  })

  it('calls each handler when its button is clicked', () => {
    const handlers = makeHandlers()
    render(<TaskHeaderActions state={makeState()} handlers={handlers} />)

    fireEvent.click(screen.getByRole('button', { name: header.start }))
    fireEvent.click(screen.getByRole('button', { name: header.switchHere }))
    fireEvent.click(screen.getByRole('button', { name: header.pause }))
    fireEvent.click(screen.getByRole('button', { name: header.complete }))

    expect(handlers.onStart).toHaveBeenCalledOnce()
    expect(handlers.onOpenSwitch).toHaveBeenCalledOnce()
    expect(handlers.onOpenPause).toHaveBeenCalledOnce()
    expect(handlers.onComplete).toHaveBeenCalledOnce()
  })
})
