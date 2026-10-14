// @vitest-environment node
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPEN_TOAST_ACTION_LABEL, toastSuccessWithOpen } from './toast-actions'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

describe('toastSuccessWithOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a success toast whose Open action runs the given callback', () => {
    const onOpen = vi.fn()

    toastSuccessWithOpen('Customer created', onOpen)

    expect(toast.success).toHaveBeenCalledWith('Customer created', {
      action: { label: OPEN_TOAST_ACTION_LABEL, onClick: onOpen },
    })
    const [, toastOptions] = vi.mocked(toast.success).mock.calls[0] as unknown as [
      string,
      { action: { onClick: () => void } },
    ]
    toastOptions.action.onClick()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('labels the action Open', () => {
    expect(OPEN_TOAST_ACTION_LABEL).toBe('Open')
  })
})
