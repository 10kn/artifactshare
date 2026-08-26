import type { TKey } from '~/i18n/messages'
import { safeInternalNext } from './safe-next'

export function oauthProviderErrorI18nKey(
  providerError: string | null,
): TKey | null {
  if (!providerError) return null
  const lower = providerError.toLowerCase()
  if (
    providerError.includes('AADSTS65001') ||
    lower.includes('consent_required')
  ) {
    return 'signin.error.admin_consent'
  }
  if (lower.includes('account_not_linked')) {
    return 'signin.error.account_not_linked'
  }
  if (lower.includes('sign-in-not-allowed')) {
    return 'signin.error.not_allowed'
  }
  return 'signin.error.generic'
}

export function signInMethod(
  params: URLSearchParams,
  providerError: string | null,
) {
  return params.get('method') === 'email' ||
    providerError?.toLowerCase().includes('account_not_linked')
    ? 'email'
    : 'provider'
}

export function signInIntent(params: URLSearchParams) {
  return params.get('intent') === 'upload' ? 'upload' : null
}

export function buildSignInErrorCallback(params: URLSearchParams) {
  const query = new URLSearchParams()
  if (signInIntent(params)) query.set('intent', 'upload')
  const next = safeInternalNext(params.get('next'))
  if (next !== '/') query.set('next', next)
  const suffix = query.toString()
  return `/sign-in${suffix ? `?${suffix}` : ''}`
}
