import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { registerGermanUiForTests } from '@/test/german-ui'
import { NavUser } from './NavUser'

registerGermanUiForTests()

afterEach(cleanup)

function renderUser(onSignOut = vi.fn()) {
  render(
    <SidebarProvider>
      <NavUser userEmail="admin@example.com" onSignOut={onSignOut} />
    </SidebarProvider>,
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
  return onSignOut
}

describe('NavUser', () => {
  it('offers German and English in the account menu', () => {
    renderUser()

    expect(screen.getByTestId('language-option-de')).toBeInTheDocument()
    expect(screen.getByTestId('language-option-en')).toBeInTheDocument()
  })

  it('signs out from the account menu', () => {
    const onSignOut = renderUser()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Abmelden' }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
