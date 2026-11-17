const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function relativeDate(iso: string | null): string {
  if (!iso) return 'never'
  const diff = new Date(iso).getTime() - Date.now()
  const days = Math.round(diff / 86_400_000)
  if (Math.abs(days) < 1) {
    const hours = Math.round(diff / 3_600_000)
    if (Math.abs(hours) < 1) return 'just now'
    return rtf.format(hours, 'hour')
  }
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
