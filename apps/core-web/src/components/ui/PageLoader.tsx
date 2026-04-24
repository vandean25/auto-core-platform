import { motion } from 'framer-motion'

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center space-y-4">
      <motion.div
        initial={{ opacity: 0.5, scale: 0.95 }}
        animate={{ 
          opacity: [0.5, 1, 0.5],
          scale: [0.95, 1, 0.95]
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-xl font-bold tracking-tighter text-white shadow-xl"
      >
        ACP
      </motion.div>
      <div className="flex flex-col items-center space-y-1">
        <p className="text-sm font-medium text-slate-600">Loading module...</p>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-200">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "linear"
            }}
            className="h-full w-1/2 bg-slate-950"
          />
        </div>
      </div>
    </div>
  )
}
