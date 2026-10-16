/** Shared Tailwind classes for workshop board swimlane columns (tablet + desktop). */
export const workshopBoardColumnClassName = [
  'flex flex-col rounded-lg border bg-slate-50 transition-colors',
  // Tablet (768–1023px): stack full-width columns — no clipped horizontal overflow.
  'w-full min-w-0 max-w-full flex-shrink-0',
  // Desktop board: fixed-width lanes in a horizontal scroller with scroll snap.
  'lg:min-w-[240px] lg:w-72 lg:max-w-none lg:flex-shrink-0 lg:snap-start',
].join(' ')
