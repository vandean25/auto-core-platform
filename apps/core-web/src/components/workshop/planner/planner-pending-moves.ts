import { createContext } from 'react'

/** Order ids whose reschedule awaits the server (capacity and conflict checks), so their booking shows pending. */
export const PlannerPendingMovesContext = createContext<ReadonlySet<string>>(new Set())
