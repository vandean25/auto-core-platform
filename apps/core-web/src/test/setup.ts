import '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { expect, vi } from 'vitest'
import React from 'react'

expect.extend(matchers)

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock framer-motion
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return {
    ...actual,
    motion: new Proxy(
      {},
      {
        get: (_target, key: string) => {
          return ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
            return React.createElement(key, props, children)
          }
        },
      }
    ),
    AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  }
})

// Mock localStorage for environments where Node global masks jsdom storage
const createStorageMock = () => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value)
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
}

const localStorageMock = createStorageMock()
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
})
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: ResizeObserverMock,
})

