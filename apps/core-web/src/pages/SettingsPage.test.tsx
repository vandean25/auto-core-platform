import './SettingsPage.test.support.test'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

import './SettingsPage.test.cases'
