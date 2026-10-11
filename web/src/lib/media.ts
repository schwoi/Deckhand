import { useSyncExternalStore } from 'react'

/** Live result of a CSS media query. Prefer Tailwind variants; use this only when layout logic needs it. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}
