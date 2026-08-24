import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/generated/openapi'
import { StatusBadge, formatStatusLabel } from '@/components/status/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { AttendancePunchBar } from './AttendancePunchBar'

type AttendanceState = components['schemas']['AttendanceState']

const actionLabels = ['Come to work', 'Pause', 'Doctor', 'Go home']

afterEach(() => {
  cleanup()
})

function renderPunchBar(state: AttendanceState, pending = false, size: 'default' | 'compact' = 'default') {
  const onPunch = vi.fn()

  const renderResult = render(
    <AttendancePunchBar
      state={state}
      pending={pending}
      size={size}
      onPunch={onPunch}
    />,
  )

  return { container: renderResult.container, onPunch }
}

function getActionButton(label: string) {
  return screen.getByRole('button', { name: label })
}

describe('AttendancePunchBar', () => {
  it('enables only Come to work while clocked out', () => {
    renderPunchBar('CLOCKED_OUT')

    expect(getActionButton('Come to work')).toBeEnabled()
    actionLabels.slice(1).forEach((label) => {
      expect(getActionButton(label)).toBeDisabled()
    })
  })

  it('enables Pause, Doctor, and Go home while clocked in', () => {
    renderPunchBar('CLOCKED_IN', false)

    expect(getActionButton('Come to work')).toBeDisabled()
    expect(getActionButton('Pause')).toBeEnabled()
    expect(getActionButton('Doctor')).toBeEnabled()
    expect(getActionButton('Go home')).toBeEnabled()
  })

  it('enables Come to work and Go home while paused', () => {
    renderPunchBar('PAUSED', false)

    expect(getActionButton('Come to work')).toBeEnabled()
    expect(getActionButton('Pause')).toBeDisabled()
    expect(getActionButton('Doctor')).toBeDisabled()
    expect(getActionButton('Go home')).toBeEnabled()
  })

  it('enables Come to work and Go home while at the doctor', () => {
    renderPunchBar('AT_DOCTOR')

    expect(getActionButton('Come to work')).toBeEnabled()
    expect(getActionButton('Go home')).toBeEnabled()
    expect(getActionButton('Pause')).toBeDisabled()
    expect(getActionButton('Doctor')).toBeDisabled()
  })

  it('disables every action while a punch is pending', () => {
    renderPunchBar('CLOCKED_IN', true)

    actionLabels.forEach((label) => {
      expect(getActionButton(label)).toBeDisabled()
    })
  })

  it('renders compact controls with the current state badge', () => {
    const { container } = renderPunchBar('CLOCKED_IN', false, 'compact')
    const stateBadge = screen.getByText('Clocked In')

    expect(stateBadge).toHaveClass(
      'border-emerald-200',
      'bg-emerald-100',
      'text-emerald-700',
      'px-2',
      'py-0.5',
    )
    expect(container.firstElementChild).toHaveClass('gap-1')
    expect(getActionButton('Come to work')).toHaveClass('h-8')
  })

  it('passes the selected attendance event type to onPunch', () => {
    const { onPunch } = renderPunchBar('CLOCKED_IN')

    fireEvent.click(getActionButton('Doctor'))

    expect(onPunch).toHaveBeenCalledWith('DOCTOR')
  })
})

describe('StatusBadge attendance mappings', () => {
  it.each([
    ['CLOCKED_IN', 'border-emerald-200', 'bg-emerald-100', 'text-emerald-700'],
    ['CLOCKED_OUT', 'border-slate-200', 'bg-slate-100', 'text-slate-700'],
    ['AT_DOCTOR', 'border-sky-200', 'bg-sky-100', 'text-sky-700'],
    ['BOOKED', 'border-emerald-200', 'bg-emerald-100', 'text-emerald-700'],
  ] as const)('uses the shared colors for %s', (status, borderClass, backgroundClass, textClass) => {
    render(<StatusBadge status={status} />)

    expect(screen.getByText(formatStatusLabel(status))).toHaveClass(
      borderClass,
      backgroundClass,
      textClass,
    )
  })
})

describe('shared shadcn primitives', () => {
  it('composes an alert with its title and description', () => {
    render(
      <Alert>
        <AlertTitle>Attendance unavailable</AlertTitle>
        <AlertDescription>Try again shortly.</AlertDescription>
      </Alert>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Attendance unavailableTry again shortly.')
  })

  it('renders a pulsing skeleton placeholder', () => {
    const { container } = render(<Skeleton className='h-4 w-20' />)

    expect(container.firstElementChild).toHaveClass('animate-pulse', 'h-4', 'w-20')
  })
})
