import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { PageLoader } from './PageLoader'

describe('PageLoader', () => {
  it('uses the application loading copy', () => {
    render(<PageLoader />)

    expect(screen.getByText(deCommon.pageLoader.loading)).toBeInTheDocument()
    expect(screen.queryByText('Loading module...')).not.toBeInTheDocument()
  })
})
