import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CatalogSourceBanner } from './CatalogSourceBanner'
import { toCatalogSourceMetadata } from '@/features/workshop/catalog-source-copy'

describe('CatalogSourceBanner', () => {
  it('renders persistent OEM source copy', () => {
    render(
      <CatalogSourceBanner
        metadata={toCatalogSourceMetadata('PARTS', {
          sourceUsed: 'OEM',
          oemStatus: 'HIT',
          fallbackReason: null,
        })}
        oemConcernCode='BMW'
      />,
    )

    expect(screen.getByTestId('catalog-source-banner-parts')).toHaveTextContent(
      'Parts: OEM catalog (BMW)',
    )
  })

  it('renders aftermarket fallback copy after OEM error', () => {
    render(
      <CatalogSourceBanner
        metadata={toCatalogSourceMetadata('LABOR', {
          sourceUsed: 'AFTERMARKET',
          oemStatus: 'ERROR',
          fallbackReason: 'ERROR',
        })}
        compact
      />,
    )

    expect(screen.getByTestId('catalog-source-banner-labor')).toHaveTextContent(
      'Labor: OEM unavailable — showing aftermarket catalog',
    )
  })
})
