import { describe, expect, test } from 'vitest'
import { oauthProviderErrorI18nKey } from './sign-in-context'

describe('oauthProviderErrorI18nKey', () => {
  test('maps allowlist deny to not_allowed', () => {
    expect(oauthProviderErrorI18nKey('sign-in-not-allowed')).toBe(
      'signin.error.not_allowed',
    )
  })

  test('maps unknown codes to generic', () => {
    expect(oauthProviderErrorI18nKey('invalid_code')).toBe(
      'signin.error.generic',
    )
  })

  test('returns null when there is no error', () => {
    expect(oauthProviderErrorI18nKey(null)).toBeNull()
  })
})
