/**
 * Scroll to and flash the form field for a config path (or its closest rendered ancestor),
 * opening collapsed sections on the way. Waits two frames so a just-switched view has rendered.
 */
export function revealField(path: string) {
  const parts = path.split('.')
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (let n = parts.length; n > 0; n--) {
        const el = document.getElementById(`f-${parts.slice(0, n).join('.')}`)
        if (!el) continue
        for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null)
          d.open = true
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true })
        el.animate(
          [
            { boxShadow: '0 0 0 3px color-mix(in oklch, var(--danger) 35%, transparent)' },
            { boxShadow: '0 0 0 3px transparent' },
          ],
          { duration: 1400, easing: 'ease-out' },
        )
        return
      }
    }),
  )
}
