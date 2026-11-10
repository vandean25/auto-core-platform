import * as React from 'react'
import type { ReactNode } from 'react'
import { Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { PageLoader } from '@/components/ui/PageLoader'

export function AnimatedRouteTreeShell({
  layoutGroupId,
  children,
}: {
  layoutGroupId: string
  children: ReactNode
}) {
  const location = useLocation()

  return (
    <LayoutGroup id={layoutGroupId}>
      <React.Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeIn' } }}
          >
            <Routes location={location}>{children}</Routes>
          </motion.div>
        </AnimatePresence>
      </React.Suspense>
    </LayoutGroup>
  )
}
