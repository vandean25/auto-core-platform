import { useTranslation } from 'react-i18next'

/** Placeholder surface for AUT-560 signature capture; no storage in AUT-557. */
export function CheckInSignatureSlot() {
  const { t } = useTranslation('workshop')

  return (
    <section
      className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4"
      data-testid="check-in-signature-slot"
      aria-label={t('checkIn.review.signatureSectionAria')}
    >
      <h3 className="text-lg font-medium">{t('checkIn.review.signatureTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('checkIn.review.signaturePlaceholder')}
      </p>
      <div
        className="mt-4 flex min-h-[120px] items-center justify-center rounded-md border border-muted bg-background text-sm text-muted-foreground"
        role="img"
        aria-hidden={false}
      >
        {t('checkIn.review.signatureCanvasPlaceholder')}
      </div>
    </section>
  )
}
