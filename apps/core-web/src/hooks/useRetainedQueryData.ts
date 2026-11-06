import { useState } from 'react'

/** Keeps the last defined query result after a failed refetch. TanStack v5 placeholder data does not. */
export function useRetainedQueryData<T>(data: T | undefined) {
  const [retained, setRetained] = useState(data)
  if (data !== undefined && data !== retained) setRetained(data)
  const value = data ?? retained
  return { data: value, isRetained: data === undefined && value !== undefined }
}
