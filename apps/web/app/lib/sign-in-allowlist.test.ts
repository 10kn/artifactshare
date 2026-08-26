import { describe, expect, test } from 'vitest'
import {
  emailMatchesAllowlist,
  isSignInAllowed,
  parseSignInAllowlist,
} from './sign-in-allowlist'

describe('sign-in allowlist', () => {
  test('allowed exact email passes', () => {
    expect(
      isSignInAllowed({
        email: 'alice@gmail.com',
        appEnv: 'production',
        emailsRaw: 'alice@gmail.com',
        domainsRaw: '',
      }),
    ).toBe(true)
  })

  test('unknown email is rejected', () => {
    expect(
      isSignInAllowed({
        email: 'stranger@gmail.com',
        appEnv: 'production',
        emailsRaw: 'alice@gmail.com',
        domainsRaw: '10kn.io',
      }),
    ).toBe(false)
  })

  test('email domain allow matches workspace addresses', () => {
    expect(
      isSignInAllowed({
        email: 'teruaki.iwane@Example.COM',
        appEnv: 'production',
        domainsRaw: 'example.com',
      }),
    ).toBe(true)
  })

  test('Google hd allow matches when the email domain differs', () => {
    expect(
      isSignInAllowed({
        email: 'guest@gmail.com',
        hd: 'example.com',
        appEnv: 'production',
        domainsRaw: 'example.com',
      }),
    ).toBe(true)
  })

  test('production empty allowlist is fail-closed', () => {
    expect(
      isSignInAllowed({
        email: 'anyone@gmail.com',
        hd: 'example.com',
        appEnv: 'production',
        domainsRaw: '',
        emailsRaw: '',
      }),
    ).toBe(false)
    expect(
      isSignInAllowed({
        email: 'anyone@gmail.com',
        appEnv: 'production',
      }),
    ).toBe(false)
  })

  test('local development with an unset allowlist stays open', () => {
    expect(
      isSignInAllowed({
        email: 'user@example.com',
        appEnv: 'development',
      }),
    ).toBe(true)
    expect(
      isSignInAllowed({
        email: 'dev@localhost',
        appEnv: undefined,
        domainsRaw: '',
        emailsRaw: '',
      }),
    ).toBe(true)
  })

  test('local development still honors a set allowlist', () => {
    expect(
      isSignInAllowed({
        email: 'stranger@gmail.com',
        appEnv: 'development',
        emailsRaw: 'alice@gmail.com',
      }),
    ).toBe(false)
  })

  test('googlemail.com matches a gmail.com allowlist email', () => {
    const list = parseSignInAllowlist({ emailsRaw: 'alice@gmail.com' })
    expect(emailMatchesAllowlist('alice@googlemail.com', null, list)).toBe(true)
  })

  test('parse treats @domain and mixed csv as domains or emails', () => {
    const list = parseSignInAllowlist({
      domainsRaw: ' Example.COM , @other.io ',
      emailsRaw: ' Alice@Gmail.com , leftover.com ',
    })
    expect(emailMatchesAllowlist('alice@gmail.com', null, list)).toBe(true)
    expect(emailMatchesAllowlist('x@example.com', null, list)).toBe(true)
    expect(emailMatchesAllowlist('y@other.io', 'other.io', list)).toBe(true)
    expect(emailMatchesAllowlist('z@leftover.com', null, list)).toBe(true)
  })
})
