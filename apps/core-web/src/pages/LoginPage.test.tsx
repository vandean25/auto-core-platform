import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LoginPage from './LoginPage'

const signIn = vi.fn()
const signInWithGoogle = vi.fn()

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    signIn,
    signInWithGoogle,
    isConfigured: true,
  }),
}))

afterEach(() => {
  cleanup()
  signIn.mockReset()
  signInWithGoogle.mockReset()
})

describe('LoginPage', () => {
  it('shows an accessible error when both fields are empty on submit', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email and password are required')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an accessible error when only email is empty', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email is required')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an accessible error when only password is empty', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Password is required')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('submits credentials when both fields are filled', async () => {
    signIn.mockResolvedValue(undefined)

    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('user@example.com', 'secret')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears validation errors when the user edits a field', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
