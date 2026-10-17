import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CatalogSourceBanner } from './CatalogSourceBanner'
import { getCatalogSourceBannerCopy, toCatalogSourceMetadata } from '@/features/workshop/catalog-source-copy'

describe('CatalogSourceBanner', () => {
  it('renders persistent OEM source copy', () => {
    const metadata = toCatalogSourceMetadata('PARTS', {
      sourceUsed: 'OEM',
      oemStatus: 'HIT',
      fallbackReason: null,
    })

    render(<CatalogSourceBanner metadata={metadata} oemConcernCode="BMW" />)

    expect(screen.getByTestId('catalog-source-banner-parts')).toHaveTextContent(
      getCatalogSourceBannerCopy(metadata, 'BMW'),
    )
  })

  it('renders aftermarket fallback copy after OEM error', () => {
    const metadata = toCatalogSourceMetadata('LABOR', {
      sourceUsed: 'AFTERMARKET',
      oemStatus: 'ERROR',
      fallbackReason: 'ERROR',
    })

    render(<CatalogSourceBanner metadata={metadata} compact />)

    expect(screen.getByTestId('catalog-source-banner-labor')).toHaveTextContent(
      getCatalogSourceBannerCopy(metadata),
    )
  })
})
