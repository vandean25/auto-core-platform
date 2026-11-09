const STICKY_CHROME_STACK =
  'max(var(--sticky-bottom-chrome-h), var(--sticky-bottom-chrome-floor, 0px))'

/** Shared Sonner offsets: phone nav plus optional sticky totals chrome (workshop checkout footer on mobile). */
export const TOAST_STACK_OFFSET_DESKTOP =
  `calc(var(--phone-nav-h) + ${STICKY_CHROME_STACK} + 24px)`
export const TOAST_STACK_OFFSET_MOBILE =
  `calc(var(--phone-nav-h) + ${STICKY_CHROME_STACK} + 2.5rem)`
