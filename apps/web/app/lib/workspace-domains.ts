const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'ymail.com',
  'proton.me',
  'protonmail.com',
])

export function normalizeEmailDomain(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return null
  const domain = trimmed.includes('@') ? trimmed.split('@').at(-1) : trimmed
  return domain || null
}

/** Google treats @googlemail.com and @gmail.com as the same mailbox; OAuth may return either. */
export function normalizeGoogleEmailAddress(email: string): string {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return trimmed
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (domain === 'googlemail.com') return `${local}@gmail.com`
  return trimmed
}

export function isPublicEmailDomain(domain?: string | null): boolean {
  const normalized = normalizeEmailDomain(domain)
  return normalized ? PUBLIC_EMAIL_DOMAINS.has(normalized) : false
}
