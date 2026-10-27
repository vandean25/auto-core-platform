import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { findSmallTouchTargets } from '@/test/touch-targets'
import { MediaSection } from './MediaSection'

beforeEach(async () => {
  await changeUiLanguage('en')
})

afterEach(cleanup)

function renderSection(overrides: Partial<React.ComponentProps<typeof MediaSection>> = {}) {
  const props: React.ComponentProps<typeof MediaSection> = {
    uploadState: 'idle',
    fileInputRef: createRef<HTMLInputElement>(),
    photoInputRef: createRef<HTMLInputElement>(),
    onPickFile: vi.fn(),
    onPickPhoto: vi.fn(),
    onFileSelected: vi.fn(),
    ...overrides,
  }
  return { ...render(<MediaSection {...props} />), props }
}

describe('MediaSection photo finding', () => {
  it('has a rear camera input for images next to the file chooser', () => {
    const { container } = renderSection()

    const camera = container.querySelector('input[capture="environment"]')
    expect(camera).toHaveAttribute('type', 'file')
    expect(camera).toHaveAttribute('accept', 'image/*')
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2)
    expect(container.querySelectorAll('input[type="file"]:not([capture])')).toHaveLength(1)
  })

  it('opens the camera from the Photo finding button', () => {
    const { props } = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Photo finding' }))

    expect(props.onPickPhoto).toHaveBeenCalledTimes(1)
    expect(props.onPickFile).not.toHaveBeenCalled()
  })

  it('hands a captured photo to the upload flow', () => {
    const { container, props } = renderSection()
    const photo = new File(['jpeg'], 'finding.jpg', { type: 'image/jpeg' })

    fireEvent.change(container.querySelector('input[capture="environment"]') as HTMLInputElement, { target: { files: [photo] } })

    expect(props.onFileSelected).toHaveBeenCalledWith(photo)
  })

  it('disables both buttons while uploading and keeps 44px targets', () => {
    const { container } = renderSection({ uploadState: 'uploading' })

    expect(screen.getByRole('button', { name: 'Photo finding' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Uploading/ })).toBeDisabled()
    expect(findSmallTouchTargets(container)).toEqual([])
  })
})
