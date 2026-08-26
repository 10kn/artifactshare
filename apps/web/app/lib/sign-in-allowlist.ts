import {
  normalizeEmailDomain,
  normalizeGoogleEmailAddress,
} from '~/lib/workspace-domains'

export type SignInAllowlist = {
  emails: Set<string>
  domains: Set<string>
}

export function parseAllowlistList(raw?: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => (part.startsWith('@') ? part.slice(1) : part))
}

export function parseSignInAllowlist(input: {
  domainsRaw?: string | null
  emailsRaw?: string | null
}): SignInAllowlist {
  const emails = new Set<string>()
  const domains = new Set<string>()
  for (const item of parseAllowlistList(input.emailsRaw)) {
    if (item.includes('@')) emails.add(normalizeGoogleEmailAddress(item))
    else {
      const domain = normalizeEmailDomain(item)
      if (domain) domains.add(domain)
    }
  }
  for (const item of parseAllowlistList(input.domainsRaw)) {
    if (item.includes('@')) emails.add(normalizeGoogleEmailAddress(item))
    else {
      const domain = normalizeEmailDomain(item)
      if (domain) domains.add(domain)
    }
  }
  return { emails, domains }
}

export function isProductionAppEnv(appEnv?: string | null): boolean {
  return appEnv === 'production'
}

export function allowlistHasEntries(list: SignInAllowlist): boolean {
  return list.emails.size > 0 || list.domains.size > 0
}

export function emailMatchesAllowlist(
  email: string,
  hd: string | null | undefined,
  list: SignInAllowlist,
): boolean {
  const normalized = normalizeGoogleEmailAddress(email)
  if (!normalized) return false
  if (list.emails.has(normalized)) return true
  const emailDomain = normalizeEmailDomain(normalized)
  if (emailDomain && list.domains.has(emailDomain)) return true
  const hosted = normalizeEmailDomain(hd)
  if (hosted && list.domains.has(hosted)) return true
  return false
}

export function isSignInAllowed(input: {
  email: string
  hd?: string | null
  appEnv?: string | null
  domainsRaw?: string | null
  emailsRaw?: string | null
}): boolean {
  const list = parseSignInAllowlist({
    domainsRaw: input.domainsRaw,
    emailsRaw: input.emailsRaw,
  })
  if (isProductionAppEnv(input.appEnv)) {
    return emailMatchesAllowlist(input.email, input.hd, list)
  }
  // Local / test: an unset allowlist must not brick fixture or `pnpm dev` sign-in.
  if (!allowlistHasEntries(list)) return true
  return emailMatchesAllowlist(input.email, input.hd, list)
}
