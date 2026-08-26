import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { PublicFooter } from './public-footer'

let mockedLocale = 'en' as 'en' | 'ja'

vi.mock('~/hooks/use-t', () => ({
  useT: () => ({
    locale: mockedLocale,
    t: (key: string) =>
      ({
        'lp.privacy': 'Privacy',
        'lp.terms': 'Terms',
        'lp.tokushoho': 'Commercial Disclosure',
        'lp.pricing': 'Pricing',
        'footer.connect': 'Connect',
        'footer.shareWithAi': 'Share with AI',
        'footer.about': 'About Icon Share',
        'footer.operatedBy': 'Operated by',
        'footer.operatorName': 'TechTalk, Inc.',
        'footer.upstreamAttribution': 'Based on __UPSTREAM__ (source-available)',
        'updates.pageTitle': 'Updates',
        'lp.invite.about': 'Share files made with AI, just within your company',
        'footer.colProduct': 'Product',
        'footer.colLegal': 'Legal',
        'analyticsConsent.change': 'Analytics settings',
        'vw.homeLink': 'Icon Share home',
        'menu.appTheme': 'Theme',
        'menu.appThemeSystem': 'System',
        'menu.appThemeLight': 'Light',
        'menu.appThemeDark': 'Dark',
      })[key] ?? key,
  }),
}))

vi.mock('~/components/app/brand-mark', () => ({ BrandMark: () => <span /> }))
vi.mock('~/components/app/analytics-consent-provider', () => ({
  useAnalyticsConsent: () => ({ openBanner: vi.fn() }),
}))

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return {
    ...actual,
    useFetcher: () => ({ formData: undefined, submit: vi.fn() }),
    useRouteLoaderData: () => ({ appTheme: 'system' }),
  }
})

describe('PublicFooter', () => {
  test.each([
    ['en', '/about'],
    ['ja', '/ja/about'],
  ] as const)('hides SaaS legal chrome and keeps attribution for %s', (locale, aboutHref) => {
    mockedLocale = locale
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    )
    expect(html).toContain('data-slot="public-footer" data-variant="full"')
    expect(html).not.toContain('href="/privacy"')
    expect(html).not.toContain('href="/ja/privacy"')
    expect(html).not.toContain('href="/terms"')
    expect(html).not.toContain('href="/tokushoho"')
    expect(html).not.toContain('Analytics settings')
    expect(html).not.toContain('Operated by')
    expect(html).not.toContain('TechTalk, Inc.')
    expect(html).not.toContain('href="/pricing"')
    expect(html).toContain(`href="${aboutHref}"`)
    expect(html).toContain('About Icon Share')
    expect(html).toContain('Based on ')
    expect(html).toContain('>Artifact Share</a>')
    expect(html).toContain('(source-available)')
    expect(html).toContain(`© ${new Date().getFullYear()} Icon Share`)
    expect(html).toContain(
      'href="https://github.com/artifactshare/artifactshare"',
    )
    expect(html).toMatch(/<a[^>]*aria-label="[^"]*"[^>]*href="\/"/)
  })

  test('minimal keeps attribution and copyright without legal links', () => {
    mockedLocale = 'en'
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PublicFooter variant="minimal" />
      </MemoryRouter>,
    )
    expect(html).toContain('data-slot="public-footer" data-variant="minimal"')
    expect(html).not.toContain('href="/connect"')
    expect(html).not.toContain('href="/about"')
    expect(html).not.toContain('href="/privacy"')
    expect(html).not.toContain('href="/terms"')
    expect(html).not.toContain('href="/tokushoho"')
    expect(html).not.toContain('Analytics settings')
    expect(html).toContain('>Artifact Share</a>')
    expect(html).toContain(`© ${new Date().getFullYear()} Icon Share`)
    expect(html).not.toContain('aria-label="Language"')
    expect(html).not.toContain('href="/ja"')
  })

  test.each([
    ['/', 'en', '/ja', 'English'],
    ['/ja', 'ja', '/', '日本語'],
  ] as const)(
    '%s full footer links to the other locale',
    (path, locale, otherHref, currentLabel) => {
      mockedLocale = locale
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <PublicFooter />
        </MemoryRouter>,
      )

      expect(html).toContain(`href="${otherHref}"`)
      expect(html).toContain(`aria-current="true">${currentLabel}</span>`)
    },
  )

  test('preserves query and hash when switching locale on a landing page', () => {
    mockedLocale = 'en'
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/?utm_source=test#pricing']}>
        <PublicFooter />
      </MemoryRouter>,
    )

    expect(html).toContain('href="/ja?utm_source=test#pricing"')
  })
})
