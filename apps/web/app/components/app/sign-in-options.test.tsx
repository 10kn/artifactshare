import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { SignInOptions } from './sign-in-options'

const rootData = vi.hoisted(() => ({
  microsoftSignIn: false,
}))

vi.mock('~/hooks/use-t', () => ({
  useT: () => ({
    t: (key: string) =>
      ({
        'lp.cta': 'Continue with Google',
        'signin.ms.cta': 'Sign in with Microsoft',
      })[key] ?? key,
  }),
}))

vi.mock('react-router', () => ({
  useRouteLoaderData: () => rootData,
}))

vi.mock('~/lib/auth-client', () => ({
  signIn: { social: vi.fn() },
}))

vi.mock('./google-mark', () => ({
  GoogleMark: () => <span>Google</span>,
}))

vi.mock('./microsoft-mark', () => ({
  MicrosoftMark: () => <span>Microsoft</span>,
}))

vi.mock('./last-used-badge', () => ({
  LastUsedBadge: () => null,
}))

describe('SignInOptions', () => {
  test('hides Microsoft when the provider is unconfigured', () => {
    rootData.microsoftSignIn = false
    const html = renderToStaticMarkup(<SignInOptions />)
    expect(html).toContain('Continue with Google')
    expect(html).not.toContain('Sign in with Microsoft')
  })

  test('shows Microsoft when the provider is configured', () => {
    rootData.microsoftSignIn = true
    const html = renderToStaticMarkup(<SignInOptions />)
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Sign in with Microsoft')
  })
})
